const musicForm = document.querySelector('#music-form');
const rangeInputs = document.querySelectorAll('.music-form input[type="range"]');
const chatOutput = document.querySelector('#chat-output');

rangeInputs.forEach((input) => {
  const output = document.querySelector(`output[for="${input.id}"]`);
  input.addEventListener('input', () => { output.value = Number(input.value).toFixed(2); });
});

musicForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const title = document.querySelector('#song-title').value.trim() || 'This song';
  const genre = document.querySelector('#song-genre').value;
  const tempo = Number(document.querySelector('#song-tempo').value);
  const danceability = Number(document.querySelector('#song-danceability').value);
  const energy = Number(document.querySelector('#song-energy').value);
  const duration = Number(document.querySelector('#song-duration').value);
  const explicit = document.querySelector('#song-explicit').checked;
  const tempoFit = Math.max(0, 1 - Math.abs(tempo - 120) / 120);
  const durationFit = Math.max(0, 1 - Math.abs(duration - 210) / 300);
  const genreBoost = ['Pop', 'Rap', 'R&B', 'EDM'].includes(genre) ? 5 : 0;
  const popularity = Math.round(Math.min(100, Math.max(0, 20 + danceability * 30 + energy * 24 + tempoFit * 12 + durationFit * 9 + genreBoost - (explicit ? 1 : 0))));
  const danceRead = danceability >= .7 ? 'high danceability' : danceability >= .45 ? 'moderate danceability' : 'lower danceability';
  const energyRead = energy >= .7 ? 'high energy' : energy >= .45 ? 'moderate energy' : 'lower energy';
  const tempoRead = tempo >= 100 && tempo <= 140 ? 'a mid-tempo range' : tempo < 100 ? 'a slower tempo' : 'a faster tempo';
  const explicitRead = explicit ? 'It is marked as explicit.' : 'It is not marked as explicit.';

  chatOutput.innerHTML = `<div class="score-line"><span class="score-number">${popularity}</span><span><strong>Estimated popularity</strong><small>out of 100</small></span></div><p class="chat-message"><strong>${title}</strong> is a ${genre.toLowerCase()} track with ${danceRead}, ${energyRead}, and ${tempoRead} at ${tempo} BPM. Its duration is ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}. ${explicitRead}</p><div class="result-tags"><span>${genre}</span><span>${danceability.toFixed(2)} danceability</span><span>${energy.toFixed(2)} energy</span></div>`;
});