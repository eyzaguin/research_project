const fs = require("node:fs");
const path = require("node:path");

const [inputFile, outputDir] = process.argv.slice(2);
if (!inputFile || !outputDir) {
  throw new Error("Usage: node assignment-03-prepare.js <source.csv> <output-directory>");
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function quantile(values, proportion) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const parsed = parseCsv(fs.readFileSync(inputFile, "utf8"));
const headers = parsed.shift();
if (!headers?.length) throw new Error("The source CSV is empty.");
const indexByName = Object.fromEntries(headers.map((name, index) => [name, index]));
const requiredFields = [
  "track_id", "track_name", "artists", "album_name", "track_genre",
  "popularity", "duration_ms", "explicit", "danceability", "energy", "tempo"
];
for (const field of requiredFields) {
  if (!(field in indexByName)) throw new Error(`Required dataset field missing: ${field}`);
}

const textFields = ["track_id", "artists", "album_name", "track_name", "track_genre"];
const numericFields = [
  "popularity", "duration_ms", "danceability", "energy", "key", "loudness",
  "mode", "speechiness", "acousticness", "instrumentalness", "liveness",
  "valence", "tempo", "time_signature"
];
const missingByField = Object.fromEntries(headers.map(field => [field, 0]));
const invalidNumericByField = Object.fromEntries(numericFields.map(field => [field, 0]));
const whitespaceChanges = Object.fromEntries(textFields.map(field => [field, 0]));
const genreLabels = new Map();
const exactRows = new Map();
const seenTrackIds = new Set();
const trackIdGenres = new Map();
const records = [];
let explicitParseErrors = 0;

for (const sourceRow of parsed) {
  const sourceValue = field => sourceRow[indexByName[field]] ?? "";
  const trimmedText = Object.fromEntries(textFields.map(field => {
    const raw = sourceValue(field);
    const value = raw.trim();
    if (raw !== value) whitespaceChanges[field]++;
    return [field, value];
  }));
  for (const field of headers) {
    if ((sourceValue(field) ?? "").trim() === "") missingByField[field]++;
  }

  const normalizedGenre = trimmedText.track_genre.toLowerCase();
  if (!genreLabels.has(normalizedGenre)) genreLabels.set(normalizedGenre, new Set());
  genreLabels.get(normalizedGenre).add(trimmedText.track_genre);

  const values = {};
  for (const field of headers) {
    if (textFields.includes(field)) {
      values[field] = field === "track_genre" ? normalizedGenre : trimmedText[field];
    } else if (field === "explicit") {
      const booleanValue = sourceValue(field).trim().toLowerCase();
      if (booleanValue !== "true" && booleanValue !== "false") {
        explicitParseErrors++;
        values[field] = sourceValue(field);
      } else {
        values[field] = booleanValue === "true";
      }
    } else if (numericFields.includes(field)) {
      const raw = sourceValue(field).trim();
      if (raw === "") {
        values[field] = null;
      } else {
        const number = Number(raw);
        if (!Number.isFinite(number)) {
          invalidNumericByField[field]++;
          values[field] = raw;
        } else {
          values[field] = number;
        }
      }
    } else {
      values[field] = sourceValue(field);
    }
  }

  const exactSignature = JSON.stringify(headers.map(field => values[field]));
  exactRows.set(exactSignature, (exactRows.get(exactSignature) ?? 0) + 1);
  const id = String(values.track_id ?? "");
  const genre = String(values.track_genre ?? "");
  seenTrackIds.add(id);
  if (!trackIdGenres.has(id)) trackIdGenres.set(id, new Set());
  trackIdGenres.get(id).add(genre);

  records.push({ values, exactSignature });
}

const exactDuplicateRows = [...exactRows.values()].reduce((sum, occurrences) => sum + Math.max(0, occurrences - 1), 0);
const dataRows = records.length;
const uniqueGenreLabels = [...genreLabels.values()].reduce((sum, labels) => sum + labels.size, 0);
const uniqueRecords = [];
const seenExactRows = new Set();
for (const record of records) {
  if (seenExactRows.has(record.exactSignature)) continue;
  seenExactRows.add(record.exactSignature);
  uniqueRecords.push(record);
}
const iqrOutlierSummary = {};
for (const field of ["popularity", "danceability", "energy", "tempo", "duration_ms", "valence"]) {
  const observed = uniqueRecords.map(record => record.values[field]).filter(Number.isFinite);
  const q1 = quantile(observed, .25);
  const q3 = quantile(observed, .75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  iqrOutlierSummary[field] = {
    lowFence,
    highFence,
    flaggedCount: observed.filter(value => value < lowFence || value > highFence).length
  };
}

const preparedHeaders = [...headers, "duration_min", "prep_flags"];
const cleanedRows = [];
const preparedRowsByGenre = new Map();
const seenTrackGenre = new Set();
const qualityCounts = {
  exactDuplicateRowsRemoved: dataRows - uniqueRecords.length,
  repeatedTrackGenreRowsRetained: 0,
  missingMetadataRowsRetained: 0,
  zeroTempoRowsFlagged: 0,
  zeroDurationRowsFlagged: 0,
  outlierRowsFlagged: 0
};
const featuresForOutliers = ["popularity", "danceability", "energy", "tempo", "duration_ms", "valence"];
const fences = Object.fromEntries(Object.entries(iqrOutlierSummary).map(([field, summary]) => [field, summary]));

for (const record of uniqueRecords) {
  const values = record.values;
  const flags = [];
  const trackGenreKey = `${values.track_id}\u001f${values.track_genre}`;
  if (seenTrackGenre.has(trackGenreKey)) {
    qualityCounts.repeatedTrackGenreRowsRetained++;
    flags.push("repeated_track_id_and_genre_review");
  }
  seenTrackGenre.add(trackGenreKey);
  const hasMissingMetadata = textFields.some(field => values[field] === "");
  if (hasMissingMetadata) {
    qualityCounts.missingMetadataRowsRetained++;
    flags.push("missing_metadata");
  }
  if (values.tempo === 0) {
    qualityCounts.zeroTempoRowsFlagged++;
    flags.push("zero_tempo_review");
  }
  if (values.duration_ms === 0) {
    qualityCounts.zeroDurationRowsFlagged++;
    flags.push("zero_duration_review");
  }
  let hasOutlier = false;
  for (const field of featuresForOutliers) {
    const value = values[field];
    if (Number.isFinite(value) && (value < fences[field].lowFence || value > fences[field].highFence)) {
      flags.push(`iqr_outlier_${field}`);
      hasOutlier = true;
    }
  }
  if (hasOutlier) qualityCounts.outlierRowsFlagged++;

  const row = preparedHeaders.map(field => {
    if (field === "duration_min") {
      return Number.isFinite(values.duration_ms) ? values.duration_ms / 60000 : "";
    }
    if (field === "prep_flags") return flags.join(";");
    const value = values[field];
    return value === null ? "" : value;
  });
  cleanedRows.push(row);
  const preparedGenre = String(values.track_genre ?? "");
  preparedRowsByGenre.set(preparedGenre, (preparedRowsByGenre.get(preparedGenre) ?? 0) + 1);
}

fs.mkdirSync(outputDir, { recursive: true });
const csvOutput = [
  preparedHeaders.map(csvCell).join(","),
  ...cleanedRows.map(row => row.map(csvCell).join(","))
].join("\r\n") + "\r\n";
fs.writeFileSync(path.join(outputDir, "spotify-tracks-prepared.csv"), csvOutput);

const audit = {
  sourceFile: path.basename(inputFile),
  originalRows: dataRows,
  preparedRows: cleanedRows.length,
  originalColumns: headers.length,
  preparedColumns: preparedHeaders.length,
  genreCount: uniqueGenreLabels,
  uniqueTrackIds: seenTrackIds.size,
  trackIdsWithMultipleGenres: [...trackIdGenres.values()].filter(genres => genres.size > 1).length,
  preparedGenreRowCountRange: {
    minimum: Math.min(...preparedRowsByGenre.values()),
    maximum: Math.max(...preparedRowsByGenre.values())
  },
  exactDuplicateRowsBeforePreparation: exactDuplicateRows,
  exactDuplicateRowsRemoved: dataRows - uniqueRecords.length,
  missingValuesByField: Object.fromEntries(Object.entries(missingByField).filter(([, count]) => count > 0)),
  numericParseErrorsByField: Object.fromEntries(Object.entries(invalidNumericByField).filter(([, count]) => count > 0)),
  explicitParseErrors,
  textWhitespaceTrimmedByField: Object.fromEntries(Object.entries(whitespaceChanges).filter(([, count]) => count > 0)),
  inconsistentGenreLabels: [...genreLabels.entries()]
    .filter(([, labels]) => labels.size > 1)
    .map(([normalized, labels]) => ({ normalized, variants: [...labels] })),
  qualityCounts,
  iqrOutlierSummary,
  decisions: [
    "Remove exact duplicate rows after trimming text and normalizing genre labels.",
    "Do not deduplicate on track_id alone; preserve tracks assigned to multiple genres.",
    "Keep missing track, album, and artist metadata blank and flag the row rather than inventing values.",
    "Convert explicit to boolean and numeric measure columns to numeric values; preserve track identifiers and descriptive labels as text.",
    "Normalize genre labels with trim and lowercase; leave labels unchanged when already consistent.",
    "Add duration_min while retaining the original duration_ms field.",
    "Flag zero tempo, zero duration, and Tukey IQR outliers for review; retain flagged observations in the prepared file.",
    "Keep popularity score 0 because it is within the documented 0–100 range."
  ]
};
fs.writeFileSync(path.join(outputDir, "preparation-audit.json"), JSON.stringify(audit, null, 2));
console.log(JSON.stringify(audit, null, 2));
