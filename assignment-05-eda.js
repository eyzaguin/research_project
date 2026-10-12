const fs = require("node:fs");
const path = require("node:path");

const [inputFile, outputDir] = process.argv.slice(2);
if (!inputFile || !outputDir) {
  throw new Error("Usage: node assignment-05-eda.js <tracks.csv> <output-directory>");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
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
      if (char === "\r" && text[i + 1] === "\n") i++;
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

const input = fs.readFileSync(inputFile, "utf8");
const rows = parseCsv(input);
const headers = rows.shift();
const column = Object.fromEntries(headers.map((name, index) => [name, index]));
const required = [
  "track_id", "track_name", "artists", "popularity", "duration_ms",
  "danceability", "energy", "tempo", "valence", "acousticness",
  "speechiness", "track_genre"
];
for (const name of required) {
  if (!(name in column)) throw new Error(`Dataset is missing required field: ${name}`);
}

const missing = Object.fromEntries(headers.map(name => [name, 0]));
const ids = new Set();
const idGenres = new Map();
const idGenreCounts = new Map();
const exactRowCounts = new Map();
const categoryLabels = new Map();
const whitespaceCounts = Object.fromEntries(headers.map(name => [name, 0]));
const numericFields = ["popularity", "duration_ms", "danceability", "energy", "key", "loudness", "mode", "speechiness", "acousticness", "instrumentalness", "liveness", "valence", "tempo", "time_signature"];
const numericParseErrors = Object.fromEntries(numericFields.map(name => [name, 0]));
let explicitParseErrors = 0;
let duplicateTrackIds = 0;
const tracks = rows.map(row => {
  const rawValue = name => row[column[name]] ?? "";
  for (const name of headers) {
    if (name === "prep_flags") continue;
    if (rawValue(name).trim() === "") missing[name]++;
    if (rawValue(name) !== rawValue(name).trim()) whitespaceCounts[name]++;
  }
  for (const name of numericFields) {
    if (rawValue(name).trim() !== "" && !Number.isFinite(Number(rawValue(name)))) numericParseErrors[name]++;
  }
  if (!["true", "false"].includes(rawValue("explicit").trim().toLowerCase())) explicitParseErrors++;
  const genre = rawValue("track_genre");
  const normalizedGenre = genre.trim().toLowerCase();
  if (!categoryLabels.has(normalizedGenre)) categoryLabels.set(normalizedGenre, new Set());
  categoryLabels.get(normalizedGenre).add(genre);
  const signature = JSON.stringify(row);
  exactRowCounts.set(signature, (exactRowCounts.get(signature) ?? 0) + 1);
  const number = name => rawValue(name) === "" ? NaN : Number(rawValue(name));
  const track = {
    id: rawValue("track_id"),
    name: rawValue("track_name"),
    artist: rawValue("artists"),
    genre: rawValue("track_genre"),
    popularity: number("popularity"),
    danceability: number("danceability"),
    energy: number("energy"),
    valence: number("valence"),
    tempo: number("tempo"),
    duration: number("duration_ms") / 60000,
    acousticness: number("acousticness"),
    speechiness: number("speechiness")
  };
  if (ids.has(track.id)) duplicateTrackIds++;
  ids.add(track.id);
  if (!idGenres.has(track.id)) idGenres.set(track.id, new Set());
  idGenres.get(track.id).add(track.genre);
  const idGenreKey = `${track.id}\u001f${track.genre}`;
  idGenreCounts.set(idGenreKey, (idGenreCounts.get(idGenreKey) ?? 0) + 1);
  return track;
});
const exactDuplicateRows = [...exactRowCounts.values()].reduce((total, frequency) => total + Math.max(0, frequency - 1), 0);
const duplicatedIdGenreRows = [...idGenreCounts.values()].reduce((total, frequency) => total + Math.max(0, frequency - 1), 0);
const repeatedIdGenreKeys = [...idGenreCounts.values()].filter(frequency => frequency > 1).length;

fs.mkdirSync(outputDir, { recursive: true });
const colors = {
  ink: "#202a31", muted: "#727b78", accent: "#278675",
  pale: "#dcebe5", orange: "#db805f", blue: "#5b8fa8",
  line: "#d8d9d1", paper: "#fbfaf6"
};
const format = (value, digits = 1) => Number(value).toFixed(digits);
const extent = values => values.reduce(
  (result, value) => [Math.min(result[0], value), Math.max(result[1], value)],
  [Infinity, -Infinity]
);
function quantile(values, proportion) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * proportion;
  const lower = Math.floor(at);
  const upper = Math.ceil(at);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (at - lower);
}
function correlation(left, right) {
  let meanLeft = 0;
  let meanRight = 0;
  for (let i = 0; i < left.length; i++) {
    meanLeft += left[i];
    meanRight += right[i];
  }
  meanLeft /= left.length;
  meanRight /= right.length;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i] - meanLeft;
    const b = right[i] - meanRight;
    covariance += a * b;
    varianceLeft += a * a;
    varianceRight += b * b;
  }
  return covariance / Math.sqrt(varianceLeft * varianceRight);
}
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[char]);
}
function saveChart(file, title, description, width, height, content) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc>
<rect width="100%" height="100%" fill="${colors.paper}"/>
<style>text{font-family:Arial,sans-serif;fill:${colors.ink}}.small{font-size:12px;fill:${colors.muted}}.axis{stroke:${colors.line};stroke-width:1}.grid{stroke:${colors.line};stroke-width:1;opacity:.7}</style>
<text x="55" y="38" font-size="22" font-weight="700">${escapeXml(title)}</text>
<text x="55" y="61" class="small">${escapeXml(description)}</text>${content}</svg>`;
  fs.writeFileSync(path.join(outputDir, file), svg);
}
function axes(x, y, width, height, xLabel, yLabel, xMax, yMax, xSteps = 5) {
  let content = "";
  for (let i = 0; i <= 4; i++) {
    const yy = y + height - height * i / 4;
    content += `<line x1="${x}" y1="${yy}" x2="${x + width}" y2="${yy}" class="grid"/>`;
    content += `<text x="${x - 9}" y="${yy + 4}" text-anchor="end" class="small">${Math.round(yMax * i / 4).toLocaleString()}</text>`;
  }
  for (let i = 0; i <= xSteps; i++) {
    const xx = x + width * i / xSteps;
    content += `<text x="${xx}" y="${y + height + 22}" text-anchor="middle" class="small">${format(xMax * i / xSteps, xMax > 10 ? 0 : 1)}</text>`;
  }
  content += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + height}" class="axis"/>`;
  content += `<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" class="axis"/>`;
  content += `<text x="${x + width / 2}" y="${y + height + 52}" text-anchor="middle" class="small">${escapeXml(xLabel)}</text>`;
  content += `<text transform="translate(20 ${y + height / 2}) rotate(-90)" text-anchor="middle" class="small">${escapeXml(yLabel)}</text>`;
  return content;
}
function histogram(values, low, high, bins, xLabel) {
  const counts = Array(bins).fill(0);
  let omitted = 0;
  for (const value of values) {
    if (value < low || value > high) {
      omitted++;
      continue;
    }
    counts[Math.min(bins - 1, Math.floor((value - low) / (high - low) * bins))]++;
  }
  const x = 82, y = 105, width = 750, height = 245;
  const peak = Math.max(...counts);
  const scale = Math.ceil(peak / 4) * 4;
  let content = axes(x, y, width, height, xLabel, "Tracks", high - low, scale);
  content += counts.map((count, index) => {
    const barHeight = count / scale * height;
    return `<rect x="${x + index * width / bins + 1}" y="${y + height - barHeight}" width="${width / bins - 2}" height="${barHeight}" fill="${colors.accent}" opacity=".88"/>`;
  }).join("");
  if (omitted) {
    content += `<text x="55" y="430" class="small">${omitted.toLocaleString()} tracks outside the displayed range are excluded from the bars.</text>`;
  }
  return content;
}

const fields = ["popularity", "danceability", "energy", "valence", "tempo", "duration", "acousticness", "speechiness"];
const values = Object.fromEntries(fields.map(field => [field, tracks.map(track => track[field])]));
const count = tracks.length;
saveChart("01-popularity.svg", "Popularity distribution", `${count.toLocaleString()} tracks | score from 0 to 100`, 900, 470,
  histogram(values.popularity, 0, 100, 20, "Popularity (5-point bins)"));
const danceExtent = extent(values.danceability);
saveChart("02-danceability.svg", "Danceability distribution",
  `Mean ${format(values.danceability.reduce((a, b) => a + b, 0) / count, 3)} | range ${format(danceExtent[0], 2)}–${format(danceExtent[1], 2)}`,
  900, 470, histogram(values.danceability, 0, 1, 20, "Danceability (0 to 1)"));

function energyValenceChart() {
  const x = 82, y = 110, width = 750, height = 245, bins = 20;
  const energyCounts = Array(bins).fill(0);
  const valenceCounts = Array(bins).fill(0);
  for (let i = 0; i < count; i++) {
    energyCounts[Math.min(bins - 1, Math.floor(values.energy[i] * bins))]++;
    valenceCounts[Math.min(bins - 1, Math.floor(values.valence[i] * bins))]++;
  }
  const peak = Math.max(...energyCounts, ...valenceCounts);
  const scale = Math.ceil(peak / 4) * 4;
  let content = axes(x, y, width, height, "Feature value (0 to 1)", "Tracks", 1, scale);
  for (let i = 0; i < bins; i++) {
    const barWidth = width / bins - 3;
    content += `<rect x="${x + i * width / bins + 1}" y="${y + height - energyCounts[i] / scale * height}" width="${barWidth}" height="${energyCounts[i] / scale * height}" fill="${colors.accent}" opacity=".58"/>`;
    content += `<rect x="${x + i * width / bins + 1}" y="${y + height - valenceCounts[i] / scale * height}" width="${barWidth}" height="${valenceCounts[i] / scale * height}" fill="${colors.orange}" opacity=".58"/>`;
  }
  content += `<rect x="620" y="78" width="12" height="12" fill="${colors.accent}"/><text x="638" y="89" class="small">Energy</text><rect x="695" y="78" width="12" height="12" fill="${colors.orange}"/><text x="713" y="89" class="small">Valence</text>`;
  return content;
}
saveChart("03-energy-valence.svg", "Energy and valence distributions", `${count.toLocaleString()} tracks | overlaid histograms with 0.05-wide bins`, 900, 470, energyValenceChart());

function tempoDurationChart() {
  let content = "";
  const panels = [
    { field: "tempo", label: "Tempo (BPM)", max: 240, color: colors.blue },
    { field: "duration", label: "Duration (minutes)", max: 10, color: colors.orange }
  ];
  for (let p = 0; p < panels.length; p++) {
    const panel = panels[p], x = 82, y = 115 + p * 260, width = 750, height = 170, bins = 25;
    const counts = Array(bins).fill(0);
    let beyond = 0;
    for (const value of values[panel.field]) {
      if (value < 0 || value > panel.max) { beyond++; continue; }
      counts[Math.min(bins - 1, Math.floor(value / panel.max * bins))]++;
    }
    const peak = Math.max(...counts);
    content += `<text x="${x}" y="${y - 16}" font-size="15" font-weight="700">${panel.label} · ${beyond.toLocaleString()} beyond 0–${panel.max}</text>`;
    counts.forEach((bin, i) => {
      const barHeight = bin / peak * height;
      content += `<rect x="${x + i * width / bins + 1}" y="${y + height - barHeight}" width="${width / bins - 2}" height="${barHeight}" fill="${panel.color}" opacity=".85"/>`;
    });
    content += `<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" class="axis"/><text x="${x}" y="${y + height + 19}" class="small">0</text><text x="${x + width}" y="${y + height + 19}" text-anchor="end" class="small">${panel.max}</text>`;
  }
  return content;
}
saveChart("04-tempo-duration.svg", "Tempo and track duration", "Histograms show distributions; extreme values outside plotted ranges are counted", 900, 650, tempoDurationChart());

const grouped = new Map();
for (const track of tracks) {
  if (!grouped.has(track.genre)) grouped.set(track.genre, []);
  grouped.get(track.genre).push(track);
}
const genres = [...grouped.entries()].map(([genre, group]) => ({
  genre, tracks: group, count: group.length,
  mean: group.reduce((sum, track) => sum + track.popularity, 0) / group.length,
  scores: group.map(track => track.popularity)
}));
function boxSummary(scores) {
  const q1 = quantile(scores, .25), median = quantile(scores, .5), q3 = quantile(scores, .75);
  const iqr = q3 - q1;
  const inliers = scores.filter(score => score >= q1 - 1.5 * iqr && score <= q3 + 1.5 * iqr);
  return { q1, median, q3, low: Math.min(...inliers), high: Math.max(...inliers) };
}
const displayedGenreNames = ["pop", "rock", "hip-hop", "edm", "r&b", "latin", "country", "classical", "jazz", "metal"];
const displayedGenres = displayedGenreNames.map(name => genres.find(genre => genre.genre === name)).filter(Boolean);
const boxGenres = displayedGenres.length >= 5 ? displayedGenres : [...genres].sort((a, b) => b.mean - a.mean).slice(0, 10);
function genreBoxChart() {
  const x = 175, y = 105, width = 655, height = 325, step = height / boxGenres.length;
  let content = "";
  for (let i = 0; i <= 5; i++) {
    const xx = x + width * i / 5;
    content += `<line x1="${xx}" y1="${y}" x2="${xx}" y2="${y + height}" class="grid"/><text x="${xx}" y="${y + height + 24}" text-anchor="middle" class="small">${i * 20}</text>`;
  }
  boxGenres.forEach((genre, index) => {
    const yy = y + step * (index + .5), stats = boxSummary(genre.scores);
    const xpos = score => x + width * score / 100;
    content += `<text x="${x - 10}" y="${yy + 4}" text-anchor="end" class="small">${escapeXml(genre.genre)} (n=${genre.count})</text>`;
    content += `<line x1="${xpos(stats.low)}" y1="${yy}" x2="${xpos(stats.high)}" y2="${yy}" stroke="${colors.ink}"/>`;
    content += `<line x1="${xpos(stats.low)}" y1="${yy - 6}" x2="${xpos(stats.low)}" y2="${yy + 6}" stroke="${colors.ink}"/>`;
    content += `<line x1="${xpos(stats.high)}" y1="${yy - 6}" x2="${xpos(stats.high)}" y2="${yy + 6}" stroke="${colors.ink}"/>`;
    content += `<rect x="${xpos(stats.q1)}" y="${yy - 7}" width="${xpos(stats.q3) - xpos(stats.q1)}" height="14" fill="${colors.pale}" stroke="${colors.accent}"/>`;
    content += `<line x1="${xpos(stats.median)}" y1="${yy - 7}" x2="${xpos(stats.median)}" y2="${yy + 7}" stroke="${colors.orange}" stroke-width="2"/>`;
    genre.scores.forEach(score => {
      if (score < stats.low || score > stats.high) {
        content += `<circle cx="${xpos(score)}" cy="${yy}" r="1.5" fill="${colors.orange}" opacity=".4"/>`;
      }
    });
  });
  return content + `<text x="${x + width / 2}" y="${y + height + 53}" text-anchor="middle" class="small">Popularity (0–100) · whiskers use 1.5×IQR</text>`;
}
saveChart("05-genre-boxplots.svg", "Popularity distributions by genre", "Selected common genres | boxes show IQR and medians; whiskers use 1.5×IQR", 900, 490, genreBoxChart());

const byMean = [...genres].sort((a, b) => a.mean - b.mean);
const extremes = [...byMean.slice(0, 10), ...byMean.slice(-10)];
function genreMeanChart() {
  const x = 220, y = 110, width = 490, height = 445, step = height / extremes.length;
  let content = "";
  extremes.forEach((genre, index) => {
    const yy = y + index * step, barWidth = width * genre.mean / 100;
    content += `<text x="${x - 10}" y="${yy + step * .65}" text-anchor="end" class="small">${escapeXml(genre.genre)}</text>`;
    content += `<rect x="${x}" y="${yy + 4}" width="${barWidth}" height="${step - 7}" fill="${index < 10 ? colors.blue : colors.accent}"/>`;
    content += `<text x="${x + barWidth + 7}" y="${yy + step * .65}" class="small">${format(genre.mean, 1)} · n=${genre.count}</text>`;
  });
  return content + `<line x1="${x}" y1="${y + height}" x2="${x + width}" y2="${y + height}" class="axis"/><text x="${x + width / 2}" y="${y + height + 34}" text-anchor="middle" class="small">Mean popularity · bottom 10 and top 10 of 114 genres</text>`;
}
saveChart("06-genre-means.svg", "Mean popularity by genre", "Ten lowest and ten highest genre means; count is shown for each group", 900, 610, genreMeanChart());

function scatterChart(field, label, file, color) {
  const x = 82, y = 105, width = 750, height = 275;
  let points = "";
  const sample = tracks.filter((_, index) => index % 23 === 0);
  for (const track of sample) {
    const px = x + width * track[field];
    const py = y + height - height * track.popularity / 100;
    points += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2" fill="${color}" opacity=".2"/>`;
  }
  const bins = 20, buckets = Array.from({ length: bins }, () => []);
  for (const track of tracks) buckets[Math.min(bins - 1, Math.floor(track[field] * bins))].push(track.popularity);
  const trendPoints = buckets.map((scores, index) => scores.length
    ? `${x + width * (index + .5) / bins},${y + height - height * scores.reduce((a, b) => a + b, 0) / scores.length / 100}`
    : "").filter(Boolean).join(" ");
  let content = axes(x, y, width, height, `${label} (0 to 1)`, "Popularity (0–100)", 1, 100);
  content += points + `<polyline points="${trendPoints}" fill="none" stroke="${colors.orange}" stroke-width="3"/>`;
  content += `<text x="590" y="430" class="small">Sampled points: n=${sample.length.toLocaleString()} · orange: 20-bin mean across all tracks</text>`;
  saveChart(file, `Popularity and ${label.toLowerCase()}`, `All ${tracks.length.toLocaleString()} tracks contribute to the binned means`, 900, 470, content);
}
scatterChart("danceability", "Danceability", "07-danceability-popularity.svg", colors.blue);
scatterChart("energy", "Energy", "08-energy-popularity.svg", colors.accent);

function correlationHeatmap() {
  const x = 275, y = 125, cell = 62;
  let content = "";
  for (let i = 0; i < fields.length; i++) {
    const label = fields[i] === "duration" ? "duration_min" : fields[i];
    content += `<text x="${x - 12}" y="${y + i * cell + 37}" text-anchor="end" class="small">${label}</text>`;
    for (let j = 0; j < fields.length; j++) {
      const value = correlation(values[fields[i]], values[fields[j]]);
      const strength = Math.abs(value);
      const fill = value >= 0
        ? `rgb(${Math.round(245 - 95 * strength)},${Math.round(248 - 40 * strength)},${Math.round(242 - 100 * strength)})`
        : `rgb(${Math.round(245 - 15 * strength)},${Math.round(240 - 130 * strength)},${Math.round(238 - 135 * strength)})`;
      content += `<rect x="${x + j * cell}" y="${y + i * cell}" width="${cell - 2}" height="${cell - 2}" fill="${fill}"/>`;
      content += `<text x="${x + j * cell + 30}" y="${y + i * cell + 36}" text-anchor="middle" font-size="11">${format(value, 2)}</text>`;
    }
  }
  fields.forEach((field, index) => {
    const label = field === "duration" ? "duration_min" : field;
    content += `<text transform="translate(${x + index * cell + 31} ${y - 9}) rotate(-45)" text-anchor="start" class="small">${label}</text>`;
  });
  return content;
}
saveChart("09-correlation-heatmap.svg", "Audio feature correlation matrix", `Pearson r | n=${count.toLocaleString()} | duration is in minutes`, 900, 730, correlationHeatmap());

const missingFields = headers.map(name => ({ name, count: missing[name] }))
  .filter(field => field.count > 0).sort((a, b) => b.count - a.count);
const tracksById = new Map();
for (const track of tracks) {
  if (!tracksById.has(track.id)) tracksById.set(track.id, new Set());
  tracksById.get(track.id).add(track.genre);
}
const idsAcrossGenres = [...tracksById.values()].filter(trackGenres => trackGenres.size > 1).length;
const durationUnder30Seconds = tracks.filter(track => track.duration > 0 && track.duration < .5).length;
const durationOver20Minutes = tracks.filter(track => track.duration > 20).length;
const tempoBelow30 = tracks.filter(track => track.tempo < 30).length;
const tempoZero = tracks.filter(track => track.tempo === 0).length;
const tempoAbove300 = tracks.filter(track => track.tempo > 300).length;
const tempoOutside30to300 = tempoBelow30 + tempoAbove300;
const invalidCoreRanges = tracks.filter(track =>
  track.popularity < 0 || track.popularity > 100 ||
  track.danceability < 0 || track.danceability > 1 ||
  track.energy < 0 || track.energy > 1 ||
  track.valence < 0 || track.valence > 1 ||
  track.duration <= 0 ||
  ![track.popularity, track.danceability, track.energy, track.valence, track.tempo, track.duration].every(Number.isFinite)
).length;
function qualityChart() {
  const x = 250, y = 118, width = 490;
  let content = `<text x="${x}" y="${y - 17}" font-size="15" font-weight="700">Missing values by field</text>`;
  if (!missingFields.length) {
    content += `<rect x="${x}" y="${y + 10}" width="${width}" height="60" fill="${colors.pale}"/>`;
    content += `<text x="${x + 12}" y="${y + 47}" font-size="16" font-weight="700">Zero missing values across all ${headers.length} fields</text>`;
  } else {
    missingFields.forEach((field, index) => {
      const yy = y + index * 21;
      content += `<text x="${x - 9}" y="${yy + 12}" text-anchor="end" class="small">${field.name}</text>`;
      const barWidth = Math.max(4, width * field.count / count);
      content += `<rect x="${x}" y="${yy}" width="${barWidth}" height="15" fill="${colors.orange}"/>`;
      content += `<text x="${x + barWidth + 6}" y="${yy + 12}" class="small">${field.count}</text>`;
    });
  }
  const top = missingFields.length ? y + missingFields.length * 21 + 40 : y + 112;
  content += `<text x="55" y="${top}" font-size="15" font-weight="700">Screening flags (review, do not auto-delete)</text>`;
  const flags = [
    ["Duplicate track IDs", duplicateTrackIds],
    ["Duration under 30 seconds", durationUnder30Seconds],
    ["Duration over 20 minutes", durationOver20Minutes],
    ["Tempo outside 30–300 BPM", tempoOutside30to300],
    ["Invalid core feature ranges", invalidCoreRanges]
  ];
  flags.forEach(([label, number], index) => {
    const x = 70 + (index >= 3 ? 405 : 0);
    const row = index >= 3 ? index - 3 : index;
    const yy = top + 29 + row * 26;
    content += `<circle cx="${x}" cy="${yy - 4}" r="5" fill="${number ? colors.orange : colors.accent}"/>`;
    content += `<text x="${x + 13}" y="${yy}" class="small">${label}: ${number.toLocaleString()}</text>`;
  });
  return content;
}
saveChart("10-missing-anomalies.svg", "Missingness and potential anomalies", `${count.toLocaleString()} tracks | ${headers.length} fields`, 900, 470, qualityChart());

const summary = {
  rowCount: count,
  columnCount: headers.length,
  genreCount: genres.length,
  uniqueTrackIds: tracksById.size,
  trackIdsAssignedToMultipleGenres: idsAcrossGenres,
  exactDuplicateRows,
  duplicatedIdGenreRows,
  repeatedIdGenreKeys,
  genreLabelsWithWhitespaceOrCaseVariants: [...categoryLabels.values()].filter(labels => labels.size > 1).length,
  numericParseErrors,
  explicitParseErrors,
  whitespaceCounts,
  missingFields,
  duplicateTrackIds,
  invalidCoreRanges,
  durationUnder30Seconds,
  durationOver20Minutes,
  tempoBelow30,
  tempoZero,
  tempoAbove300,
  tempoOutside30to300,
  featureSummary: Object.fromEntries(fields.map(field => [
    field, {
      mean: values[field].reduce((a, b) => a + b, 0) / count,
      median: quantile(values[field], .5),
      min: extent(values[field])[0],
      max: extent(values[field])[1]
    }
  ])),
  popularity: {
    mean: values.popularity.reduce((a, b) => a + b, 0) / count,
    median: quantile(values.popularity, .5),
    q1: quantile(values.popularity, .25),
    q3: quantile(values.popularity, .75),
    zeroCount: values.popularity.filter(value => value === 0).length,
    countAtLeast70: values.popularity.filter(value => value >= 70).length
  },
  correlationsWithPopularity: Object.fromEntries(fields.slice(1).map(field =>
    [field, correlation(values.popularity, values[field])]
  )),
  tempoCorrelationExcludingZero: {
    count: tracks.filter(track => track.tempo > 0).length,
    pearsonR: correlation(
      tracks.filter(track => track.tempo > 0).map(track => track.popularity),
      tracks.filter(track => track.tempo > 0).map(track => track.tempo)
    )
  },
  highestMeanGenres: [...genres].sort((a, b) => b.mean - a.mean).slice(0, 8)
    .map(genre => ({ genre: genre.genre, count: genre.count, mean: genre.mean, median: quantile(genre.scores, .5) })),
  lowestMeanGenres: [...genres].sort((a, b) => a.mean - b.mean).slice(0, 8)
    .map(genre => ({ genre: genre.genre, count: genre.count, mean: genre.mean, median: quantile(genre.scores, .5) })),
  displayedGenreMedians: boxGenres.map(genre => ({
    genre: genre.genre, count: genre.count,
    q1: quantile(genre.scores, .25), median: quantile(genre.scores, .5), q3: quantile(genre.scores, .75)
  })),
  popularityByTenPointBand: Array.from({ length: 10 }, (_, index) => ({
    band: `${index * 10}–${index * 10 + 9}`,
    count: values.popularity.filter(value => value >= index * 10 && value < (index + 1) * 10).length
  })),
  popularityByDanceabilityDecile: Array.from({ length: 10 }, (_, index) => {
    const selected = tracks.filter(track => track.danceability >= index / 10 && track.danceability < (index + 1) / 10);
    return { range: `${format(index / 10, 1)}–${format((index + 1) / 10, 1)}`, count: selected.length,
      meanPopularity: selected.reduce((sum, track) => sum + track.popularity, 0) / selected.length };
  }),
  popularityByEnergyDecile: Array.from({ length: 10 }, (_, index) => {
    const selected = tracks.filter(track => track.energy >= index / 10 && track.energy < (index + 1) / 10);
    return { range: `${format(index / 10, 1)}–${format((index + 1) / 10, 1)}`, count: selected.length,
      meanPopularity: selected.reduce((sum, track) => sum + track.popularity, 0) / selected.length };
  })
};
fs.writeFileSync(path.join(outputDir, "eda-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
