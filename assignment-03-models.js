const fs = require("node:fs");
const path = require("node:path");

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  throw new Error("Usage: node assignment-03-models.js <prepared.csv> <model-results.json>");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      field = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const input = fs.readFileSync(inputFile, "utf8");
const rows = parseCsv(input);
const headers = rows.shift();
const column = Object.fromEntries(headers.map((name, index) => [name, index]));
const features = [
  "danceability", "energy", "tempo", "duration_min", "valence",
  "acousticness", "speechiness", "instrumentalness", "liveness",
  "loudness", "key", "mode", "time_signature", "explicit"
];
for (const name of ["track_id", "track_genre", "popularity", ...features]) {
  if (!(name in column)) throw new Error(`Prepared dataset is missing required field: ${name}`);
}

const records = rows.map(row => {
  const featureValues = features.map(name => {
    const value = row[column[name]];
    return name === "explicit" ? (value === "true" ? 1 : value === "false" ? 0 : NaN) : Number(value);
  });
  return {
    id: row[column.track_id],
    genre: row[column.track_genre],
    target: Number(row[column.popularity]),
    features: featureValues
  };
}).filter(record => Number.isFinite(record.target) && record.id && record.genre &&
  record.features.every(Number.isFinite));
if (!records.length) throw new Error("No complete rows are available for model training.");

const train = [];
const test = [];
for (const record of records) {
  (fnv1a(record.id) % 5 === 0 ? test : train).push(record);
}
if (!test.length || !train.length) throw new Error("The deterministic split produced an empty partition.");

const trainMean = train.reduce((sum, record) => sum + record.target, 0) / train.length;
function evaluate(name, description, predict) {
  let absoluteError = 0;
  let squaredError = 0;
  let totalSquares = 0;
  for (const record of test) {
    const prediction = predict(record);
    const error = prediction - record.target;
    absoluteError += Math.abs(error);
    squaredError += error * error;
    totalSquares += (record.target - trainMean) ** 2;
  }
  const mae = absoluteError / test.length;
  const rmse = Math.sqrt(squaredError / test.length);
  const rSquared = 1 - squaredError / totalSquares;
  return { model: name, description, testMAE: mae, testRMSE: rmse, testR2: rSquared };
}

const results = [];
results.push(evaluate(
  "Training-mean baseline",
  "Predicts the training-set mean popularity for every track.",
  () => trainMean
));

const genreTotals = new Map();
for (const record of train) {
  const total = genreTotals.get(record.genre) ?? { sum: 0, count: 0 };
  total.sum += record.target;
  total.count++;
  genreTotals.set(record.genre, total);
}
results.push(evaluate(
  "Genre-mean baseline",
  "Predicts the training mean for the track's genre label.",
  record => {
    const total = genreTotals.get(record.genre);
    return total ? total.sum / total.count : trainMean;
  }
));

const featureMeans = features.map((_, index) =>
  train.reduce((sum, record) => sum + record.features[index], 0) / train.length
);
const featureScales = features.map((_, index) => {
  const variance = train.reduce((sum, record) =>
    sum + (record.features[index] - featureMeans[index]) ** 2, 0) / train.length;
  return Math.sqrt(variance) || 1;
});
function standardized(record, index) {
  return (record.features[index] - featureMeans[index]) / featureScales[index];
}

const parameterCount = features.length + 1;
const gram = Array.from({ length: parameterCount }, () => Array(parameterCount).fill(0));
const cross = Array(parameterCount).fill(0);
for (const record of train) {
  const vector = [1, ...features.map((_, index) => standardized(record, index))];
  for (let i = 0; i < parameterCount; i++) {
    cross[i] += vector[i] * record.target;
    for (let j = 0; j < parameterCount; j++) gram[i][j] += vector[i] * vector[j];
  }
}
for (let i = 1; i < parameterCount; i++) gram[i][i] += 1e-8;
const matrix = gram.map((row, index) => [...row, cross[index]]);
for (let pivot = 0; pivot < parameterCount; pivot++) {
  let bestRow = pivot;
  for (let row = pivot + 1; row < parameterCount; row++) {
    if (Math.abs(matrix[row][pivot]) > Math.abs(matrix[bestRow][pivot])) bestRow = row;
  }
  if (Math.abs(matrix[bestRow][pivot]) < 1e-12) throw new Error("Linear regression matrix is singular.");
  [matrix[pivot], matrix[bestRow]] = [matrix[bestRow], matrix[pivot]];
  const divisor = matrix[pivot][pivot];
  for (let col = pivot; col <= parameterCount; col++) matrix[pivot][col] /= divisor;
  for (let row = 0; row < parameterCount; row++) {
    if (row === pivot) continue;
    const factor = matrix[row][pivot];
    for (let col = pivot; col <= parameterCount; col++) matrix[row][col] -= factor * matrix[pivot][col];
  }
}
const coefficients = matrix.map(row => row[parameterCount]);
results.push(evaluate(
  "Multiple linear regression",
  "OLS with standardized numeric audio features and explicit-status indicator; fitted on training rows only.",
  record => {
    let prediction = coefficients[0];
    for (let index = 0; index < features.length; index++) {
      prediction += coefficients[index + 1] * standardized(record, index);
    }
    return prediction;
  }
));

const treeBins = 32;
const treeMaxDepth = 5;
const minimumLeaf = 100;
let treeNodeCount = 0;
function growTree(samples, depth) {
  const sum = samples.reduce((total, item) => total + item.record.target, 0);
  const sumSquares = samples.reduce((total, item) => total + item.record.target ** 2, 0);
  const mean = sum / samples.length;
  const parentSse = sumSquares - sum * sum / samples.length;
  const node = { prediction: mean, left: null, right: null, feature: -1, threshold: 0 };
  treeNodeCount++;
  if (depth >= treeMaxDepth || samples.length < minimumLeaf * 2 || parentSse <= 1e-9) return node;

  let bestGain = 0;
  let bestFeature = -1;
  let bestThreshold = 0;
  let bestLeft = null;
  let bestRight = null;
  for (let feature = 0; feature < features.length; feature++) {
    let minimum = Infinity, maximum = -Infinity;
    for (const item of samples) {
      const value = item.record.features[feature];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    if (minimum === maximum) continue;
    const counts = new Int32Array(treeBins);
    const sums = new Float64Array(treeBins);
    const squares = new Float64Array(treeBins);
    for (const item of samples) {
      const value = item.record.features[feature];
      const bin = Math.min(treeBins - 1, Math.floor((value - minimum) / (maximum - minimum) * treeBins));
      counts[bin]++;
      sums[bin] += item.record.target;
      squares[bin] += item.record.target ** 2;
    }
    let leftCount = 0, leftSum = 0, leftSquares = 0;
    for (let bin = 0; bin < treeBins - 1; bin++) {
      leftCount += counts[bin];
      leftSum += sums[bin];
      leftSquares += squares[bin];
      const rightCount = samples.length - leftCount;
      if (leftCount < minimumLeaf || rightCount < minimumLeaf) continue;
      const rightSum = sum - leftSum;
      const rightSquares = sumSquares - leftSquares;
      const gain = parentSse
        - (leftSquares - leftSum * leftSum / leftCount)
        - (rightSquares - rightSum * rightSum / rightCount);
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = feature;
        bestThreshold = minimum + (maximum - minimum) * (bin + 1) / treeBins;
      }
    }
  }
  if (bestFeature < 0) return node;
  for (const item of samples) {
    (item.record.features[bestFeature] <= bestThreshold ? (bestLeft ??= []) : (bestRight ??= [])).push(item);
  }
  if (!bestLeft || !bestRight || bestLeft.length < minimumLeaf || bestRight.length < minimumLeaf) return node;
  node.feature = bestFeature;
  node.threshold = bestThreshold;
  node.left = growTree(bestLeft, depth + 1);
  node.right = growTree(bestRight, depth + 1);
  return node;
}
function predictTree(node, record) {
  let current = node;
  while (current.left && current.right) {
    current = record.features[current.feature] <= current.threshold ? current.left : current.right;
  }
  return current.prediction;
}
const tree = growTree(train.map(record => ({ record })), 0);
results.push(evaluate(
  "Decision-tree regression",
  `CART regression tree on the same numeric audio features; max depth ${treeMaxDepth}, minimum leaf ${minimumLeaf}, ${treeNodeCount} total nodes.`,
  record => predictTree(tree, record)
));

const report = {
  target: "Spotify popularity score (0–100)",
  task: "Regression",
  sourceRows: rows.length,
  usableRows: records.length,
  predictors: features,
  categoricalGenreIncluded: false,
  genreNote: "A genre-only baseline is included; genre is not one-hot encoded in the audio-feature models.",
  split: {
    method: "Deterministic 80/20 split grouped by track_id using FNV-1a hash modulo 5; identical track IDs stay in one partition.",
    trainingRows: train.length,
    testRows: test.length,
    seed: "FNV-1a(track_id) % 5 == 0 assigns test rows"
  },
  accuracyNote: "Accuracy is a classification metric and does not apply to this numeric regression task. Report test MAE, RMSE, and R² instead.",
  models: results,
  winnerByRMSE: [...results].sort((left, right) => left.testRMSE - right.testRMSE)[0].model,
  interpretationNote: "All scores are test-set prediction metrics, not causal estimates. The genre mean baseline uses the track_genre label; the audio-feature models use numeric features only."
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
