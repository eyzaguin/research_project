const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const inputFile = process.argv[2] || path.join(root, "assignment-03-data", "spotify-tracks-prepared.csv");
const summaryFile = path.join(root, "assignment-05-figures", "eda-summary.json");
const outputDir = path.join(root, "assignment-06-figures");
const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));

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

const rows = parseCsv(fs.readFileSync(inputFile, "utf8"));
const headers = rows.shift();
const column = Object.fromEntries(headers.map((name, index) => [name, index]));
for (const name of ["popularity", "danceability", "energy", "track_genre"]) {
  if (!(name in column)) throw new Error(`Prepared dataset is missing required field: ${name}`);
}
if (!summary.rowCount || !summary.correlationsWithPopularity) {
  throw new Error("Assignment 05 summary is missing required analysis results.");
}

const tracks = rows.map(row => ({
  popularity: Number(row[column.popularity]),
  danceability: Number(row[column.danceability]),
  energy: Number(row[column.energy]),
  genre: row[column.track_genre]
}));
if (tracks.length !== summary.rowCount) {
  throw new Error(`Prepared row count ${tracks.length} does not match Assignment 05 summary (${summary.rowCount}).`);
}
if (tracks.some(track => !Number.isFinite(track.popularity)
  || !Number.isFinite(track.danceability) || !Number.isFinite(track.energy))) {
  throw new Error("Prepared dataset contains a non-numeric value required by the redesigns.");
}

const colors = {
  paper: "#fbfaf6",
  ink: "#202a31",
  muted: "#5c6768",
  grid: "#d8d9d1",
  navy: "#24506a",
  teal: "#00745a",
  orange: "#a6402b",
  paleBlue: "#d7e6eb",
  paleOrange: "#f0ded5"
};
const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
})[char]);
const text = (x, y, value, attrs = "") =>
  `<text x="${x}" y="${y}" ${attrs}>${escapeXml(value)}</text>`;
const line = (x1, y1, x2, y2, attrs = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attrs}/>`;
const rect = (x, y, width, height, attrs = "") =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" ${attrs}/>`;
const circle = (cx, cy, r, attrs = "") =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs}/>`;
const comma = value => Math.round(value).toLocaleString("en-US");
const format1 = value => Number(value).toFixed(1);

function saveChart(file, title, description, width, height, content) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(title)}</title><desc id="desc">${escapeXml(description)}</desc>
<rect width="100%" height="100%" fill="${colors.paper}"/>
<style>text{font-family:Arial,sans-serif;fill:${colors.ink}}.subtitle,.small{font-size:13px;fill:${colors.muted}}.grid{stroke:${colors.grid};stroke-width:1}.axis{stroke:${colors.ink};stroke-width:1.2}.title{font-size:26px;font-weight:700}.note{font-size:14px;font-weight:700}</style>
${text(60, 48, title, 'class="title"')}
${text(60, 76, description, 'class="subtitle"')}
${content}</svg>`;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, file), svg);
}

function popularityChart() {
  const zeroCount = tracks.filter(track => track.popularity === 0).length;
  const bands = [
    { label: "0", count: zeroCount, highlight: true },
    { label: "1–9", count: tracks.filter(track => track.popularity >= 1 && track.popularity < 10).length },
    ...Array.from({ length: 8 }, (_, index) => {
      const low = (index + 1) * 10;
      const high = low + 10;
      return {
        label: index === 7 ? "80–89" : `${low}–${high - 1}`,
        count: tracks.filter(track => track.popularity >= low && track.popularity < high).length
      };
    }),
    { label: "90–100", count: tracks.filter(track => track.popularity >= 90 && track.popularity <= 100).length }
  ];
  if (bands.reduce((sum, band) => sum + band.count, 0) !== tracks.length) {
    throw new Error("Popularity bands do not account for every prepared track.");
  }
  const width = 1120, height = 590;
  const x = 115, y = 150, chartWidth = 950, chartHeight = 300, maxPercent = 20;
  const step = chartWidth / bands.length;
  let content = "";
  for (let tick = 0; tick <= 4; tick++) {
    const value = tick * 5;
    const yy = y + chartHeight - chartHeight * value / maxPercent;
    content += line(x, yy, x + chartWidth, yy, `class="grid"`);
    content += text(x - 12, yy + 5, `${value}%`, 'class="small" text-anchor="end"');
  }
  bands.forEach((band, index) => {
    const barWidth = 48;
    const barHeight = chartHeight * band.count / tracks.length * 100 / maxPercent;
    const bx = x + index * step + (step - barWidth) / 2;
    const by = y + chartHeight - barHeight;
    const fill = band.highlight ? colors.orange : colors.paleBlue;
    const stroke = band.highlight ? colors.orange : colors.navy;
    content += rect(bx, by, barWidth, barHeight, `fill="${fill}" stroke="${stroke}" stroke-width="1.5"`);
    content += text(bx + barWidth / 2, by - 8, `${(band.count / tracks.length * 100).toFixed(1)}%`,
      'class="small" text-anchor="middle"');
    content += text(bx + barWidth / 2, y + chartHeight + 25, band.label,
      'class="small" text-anchor="middle"');
  });
  content += line(x, y + chartHeight, x + chartWidth, y + chartHeight, 'class="axis"');
  content += text(x + chartWidth / 2, y + chartHeight + 58, "Spotify popularity score band (0–100)",
    'class="small" text-anchor="middle"');
  content += text(30, y + chartHeight / 2, "Share of all tracks", 'class="small" text-anchor="middle" transform="rotate(-90 30 300)"');
  content += rect(115, 520, 14, 14, `fill="${colors.orange}"`);
  content += text(138, 532, `Zero-score tracks: ${comma(zeroCount)} (${(zeroCount / tracks.length * 100).toFixed(1)}%)`,
    'class="note"');
  content += text(1065, 532, `Median = ${summary.popularity.median}`, 'class="note" text-anchor="end"');
  return saveChart("01-popularity-redesign.svg",
    "Popularity is concentrated at low-to-middle scores",
    `${comma(tracks.length)} prepared tracks; bars show share of all tracks, with a separate zero-score category.`,
    width, height, content);
}

function genreChart() {
  const groups = new Map();
  for (const track of tracks) {
    if (!groups.has(track.genre)) groups.set(track.genre, { sum: 0, count: 0 });
    const group = groups.get(track.genre);
    group.sum += track.popularity;
    group.count++;
  }
  const genres = [...groups].map(([genre, group]) => ({
    genre, mean: group.sum / group.count, count: group.count
  })).sort((a, b) => a.mean - b.mean);
  if (genres.reduce((sum, genre) => sum + genre.count, 0) !== tracks.length || genres.length !== summary.genreCount) {
    throw new Error("Genre summaries do not match the prepared dataset and Assignment 05 summary.");
  }
  const selected = [...genres.slice(0, 10), ...genres.slice(-10)];
  const low = selected.slice(0, 10);
  const high = selected.slice(10);
  const width = 1120, height = 960;
  const x = 390, y = 165, chartWidth = 575, rowHeight = 30, groupGap = 32, max = 65;
  const fullRowsHeight = rowHeight * 20 + groupGap;
  let content = "";
  for (let tick = 0; tick <= 5; tick++) {
    const value = tick * 13;
    const xx = x + chartWidth * value / max;
    content += line(xx, y - 8, xx, y + fullRowsHeight, 'class="grid"');
    content += text(xx, y + fullRowsHeight + 28, value, 'class="small" text-anchor="middle"');
  }
  selected.forEach((genre, index) => {
    if (index === 10) {
      const dividerY = y + rowHeight * index + 4;
      content += line(50, dividerY, 1060, dividerY, `stroke="${colors.grid}" stroke-width="2"`);
      content += text(58, dividerY + 18, "HIGHEST-MEAN GENRES", 'font-size="11" font-weight="700" fill="' + colors.teal + '"');
    }
    if (index === 0) {
      content += text(58, y - 20, "LOWEST-MEAN GENRES", 'font-size="11" font-weight="700" fill="' + colors.orange + '"');
    }
    const yy = y + rowHeight * index + (index >= 10 ? groupGap : 0) + 18;
    const isHigh = index >= 10;
    const color = isHigh ? colors.teal : colors.orange;
    const pointX = x + chartWidth * genre.mean / max;
    content += text(350, yy + 4, `${genre.genre} · n=${comma(genre.count)}`,
      'class="small" text-anchor="end"');
    content += line(x, yy, pointX, yy, `stroke="${color}" stroke-width="3"`);
    content += circle(pointX, yy, 6, `fill="${color}" stroke="${colors.paper}" stroke-width="2"`);
    content += text(Math.min(pointX + 11, 1050), yy + 4, format1(genre.mean),
      'font-size="12" font-weight="700"');
  });
  content += line(x, y + fullRowsHeight, x + chartWidth, y + fullRowsHeight, 'class="axis"');
  content += text(x + chartWidth / 2, y + fullRowsHeight + 60, "Mean popularity (0–100; axis shown 0–65)",
    'class="small" text-anchor="middle"');
  content += rect(58, 912, 12, 12, `fill="${colors.orange}"`);
  content += text(78, 923, "10 lowest means", 'class="small"');
  content += rect(228, 912, 12, 12, `fill="${colors.teal}"`);
  content += text(248, 923, "10 highest means", 'class="small"');
  content += text(1060, 923, "Iranian 2.2 → pop-film 59.3 · range 57.1 points",
    'class="note" text-anchor="end"');
  return saveChart("02-genre-means-redesign.svg",
    "Genre mean popularity spans 57 points in the selected extremes",
    "The ten lowest- and ten highest-mean genres share one zero-based scale; dot labels show mean and group size.",
    width, height, content);
}

function correlationChart() {
  const entries = Object.entries(summary.correlationsWithPopularity)
    .map(([feature, value]) => ({ feature, value }))
    .sort((a, b) => a.value - b.value);
  const width = 1120, height = 590;
  const x = 360, y = 150, chartWidth = 510, rowHeight = 43, min = -0.1, max = 0.1;
  let content = "";
  for (let tick = 0; tick <= 4; tick++) {
    const value = min + (max - min) * tick / 4;
    const xx = x + chartWidth * tick / 4;
    content += line(xx, y - 10, xx, y + rowHeight * entries.length, tick === 2
      ? `stroke="${colors.ink}" stroke-width="2"`
      : 'class="grid"');
    content += text(xx, y + rowHeight * entries.length + 27, value.toFixed(2),
      'class="small" text-anchor="middle"');
  }
  entries.forEach((entry, index) => {
    const yy = y + rowHeight * index + 17;
    const xx = x + chartWidth * (entry.value - min) / (max - min);
    const color = entry.value < 0 ? colors.orange : colors.teal;
    content += text(x - 18, yy + 5, entry.feature, 'class="small" text-anchor="end"');
    content += line(x + chartWidth / 2, yy, xx, yy, `stroke="${color}" stroke-width="3"`);
    content += circle(xx, yy, 6, `fill="${color}" stroke="${colors.paper}" stroke-width="2"`);
    content += text(x + chartWidth + 18, yy + 5, `${entry.value >= 0 ? "+" : ""}${entry.value.toFixed(3)}`,
      'font-size="13" font-weight="700"');
  });
  content += text(x + chartWidth / 2, y + rowHeight * entries.length + 58,
    "Pearson correlation with popularity · detail scale ±0.10 (full scale −1 to +1)",
    'class="small" text-anchor="middle"');
  content += rect(60, 535, 13, 13, `fill="${colors.orange}"`);
  content += text(82, 547, "Negative association", 'class="small"');
  content += rect(260, 535, 13, 13, `fill="${colors.teal}"`);
  content += text(282, 547, "Positive association", 'class="small"');
  content += text(1060, 547, `All |r| ≤ ${Math.max(...entries.map(entry => Math.abs(entry.value))).toFixed(3)}`,
    'class="note" text-anchor="end"');
  return saveChart("03-popularity-correlations-redesign.svg",
    "Pooled linear correlations with popularity are near zero",
    `Seven Pearson coefficients for ${comma(summary.rowCount)} prepared tracks; the marked vertical line is zero.`,
    width, height, content);
}

function relationshipChart(field, file, title, annotation, correlation) {
  const bins = Array.from({ length: 10 }, (_, index) => ({
    low: index / 10,
    high: (index + 1) / 10,
    sum: 0,
    count: 0
  }));
  for (const track of tracks) {
    const value = track[field];
    const index = Math.min(9, Math.floor(value * 10));
    const bin = bins[index];
    bin.sum += track.popularity;
    bin.count++;
  }
  if (bins.some(bin => bin.count === 0) || bins.reduce((sum, bin) => sum + bin.count, 0) !== tracks.length) {
    throw new Error(`Unexpected or unaccounted ${field} band.`);
  }
  const width = 1120, height = 640;
  const x = 135, chartWidth = 930, step = chartWidth / bins.length;
  const countY = 150, countHeight = 110, countMax = Math.max(...bins.map(bin => bin.count)) * 1.15;
  const meanY = 350, meanHeight = 175;
  let content = "";
  content += text(x, 127, "TRACKS IN EACH FEATURE BAND", 'font-size="12" font-weight="700"');
  for (let tick = 0; tick <= 2; tick++) {
    const value = countMax * tick / 2;
    const yy = countY + countHeight - countHeight * tick / 2;
    content += line(x, yy, x + chartWidth, yy, 'class="grid"');
    content += text(x - 12, yy + 4, `${(value / 1000).toFixed(0)}k`,
      'class="small" text-anchor="end"');
  }
  bins.forEach((bin, index) => {
    const barWidth = 48, bx = x + step * index + (step - barWidth) / 2;
    const barHeight = countHeight * bin.count / countMax;
    content += rect(bx, countY + countHeight - barHeight, barWidth, barHeight,
      `fill="${colors.paleBlue}" stroke="${colors.navy}" stroke-width="1"`);
    content += text(bx + barWidth / 2, countY + countHeight - barHeight - 7, comma(bin.count),
      `font-size="10" text-anchor="middle" fill="${colors.muted}"`);
  });
  content += text(x, 323, "MEAN POPULARITY BY FEATURE BAND", 'font-size="12" font-weight="700"');
  for (let tick = 0; tick <= 4; tick++) {
    const value = tick * 25;
    const yy = meanY + meanHeight - meanHeight * value / 100;
    content += line(x, yy, x + chartWidth, yy, 'class="grid"');
    content += text(x - 12, yy + 4, value, 'class="small" text-anchor="end"');
  }
  const points = bins.map((bin, index) => ({
    x: x + step * index + step / 2,
    y: meanY + meanHeight - meanHeight * (bin.sum / bin.count) / 100,
    mean: bin.sum / bin.count
  }));
  for (let i = 0; i < points.length - 1; i++) {
    content += line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y,
      `stroke="${colors.orange}" stroke-width="3"`);
  }
  points.forEach((point, index) => {
    content += circle(point.x, point.y, 6, `fill="${colors.orange}" stroke="${colors.paper}" stroke-width="2"`);
    content += text(point.x, point.y - 12, format1(point.mean), 'font-size="11" font-weight="700" text-anchor="middle"');
    const bin = bins[index];
    const label = `${bin.low.toFixed(1)}–${bin.high.toFixed(1)}`;
    content += text(point.x, 551, label, 'class="small" text-anchor="middle"');
  });
  content += line(x, meanY + meanHeight, x + chartWidth, meanY + meanHeight, 'class="axis"');
  content += text(x + chartWidth / 2, 580, `${field[0].toUpperCase()}${field.slice(1)} score band (equal-width 0.1 intervals)`,
    'class="small" text-anchor="middle"');
  content += text(35, meanY + meanHeight / 2, "Popularity (0–100)", 'class="small" text-anchor="middle" transform="rotate(-90 35 437)"');
  content += text(1060, 613, `${annotation} · pooled r = ${correlation.toFixed(3)}`,
    'class="note" text-anchor="end"');
  return saveChart(file, title,
    `${comma(tracks.length)} tracks; upper panel shows band counts, lower panel shows mean popularity on a fixed 0–100 scale.`,
    width, height, content);
}

popularityChart();
genreChart();
correlationChart();
relationshipChart("danceability", "04-danceability-trend-redesign.svg",
  "Popularity peaks modestly at middle danceability",
  "Peak mean 34.7 at 0.5–0.6", summary.correlationsWithPopularity.danceability);
relationshipChart("energy", "05-energy-trend-redesign.svg",
  "Popularity peaks at moderate energy, not at the highest end",
  "Peak mean 36.1 at 0.4–0.5", summary.correlationsWithPopularity.energy);
console.log(`Generated 5 redesigned SVGs from ${tracks.length.toLocaleString()} prepared rows in ${outputDir}`);
