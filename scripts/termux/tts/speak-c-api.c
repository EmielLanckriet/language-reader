// Speaks a story for Reader (spec 018): MeloTTS through sherpa-onnx's C API, loaded once.
//
//   speak <model dir> <out.wav> [threads] < sentences.txt
//
// One sentence per input line. Writes one mono WAV with a pause between sentences, and prints each
// sentence's start and end in seconds on stdout, one line each, for the subtitles; "line i/n" on
// stderr as it goes. Built into sherpa-onnx's c-api-examples by scripts/termux/tts/build-tts.sh.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sherpa-onnx/c-api/c-api.h"

#define PAUSE_SECONDS 0.35f

static char *join(const char *dir, const char *name) {
  char *path = malloc(strlen(dir) + strlen(name) + 2);
  sprintf(path, "%s/%s", dir, name);
  return path;
}

int main(int argc, char *argv[]) {
  if (argc < 3) {
    fprintf(stderr, "usage: %s <model dir> <out.wav> [threads] < sentences\n", argv[0]);
    return 1;
  }
  const char *dir = argv[1];
  char *rules = malloc(3 * strlen(dir) + 64);
  sprintf(rules, "%s/phone.fst,%s/date.fst,%s/number.fst", dir, dir, dir);

  SherpaOnnxOfflineTtsConfig config;
  memset(&config, 0, sizeof(config));
  config.model.vits.model = join(dir, "model.onnx");
  config.model.vits.lexicon = join(dir, "lexicon.txt");
  config.model.vits.tokens = join(dir, "tokens.txt");
  config.model.vits.noise_scale = 0.667f;
  config.model.vits.noise_scale_w = 0.8f;
  config.model.vits.length_scale = 1.0f;
  config.model.num_threads = argc > 3 ? atoi(argv[3]) : 2;
  config.model.provider = "cpu";
  config.rule_fsts = rules;
  config.max_num_sentences = 1;

  const SherpaOnnxOfflineTts *tts = SherpaOnnxCreateOfflineTts(&config);
  if (!tts) {
    fprintf(stderr, "could not load the model in %s\n", dir);
    return 1;
  }

  char **lines = NULL;
  int count = 0;
  char buffer[8192];
  while (fgets(buffer, sizeof(buffer), stdin)) {
    buffer[strcspn(buffer, "\r\n")] = 0;
    if (!buffer[0]) continue;
    lines = realloc(lines, (count + 1) * sizeof(char *));
    lines[count++] = strdup(buffer);
  }

  float *all = NULL;
  long total = 0;
  int rate = 0;
  SherpaOnnxGenerationConfig generation;
  memset(&generation, 0, sizeof(generation));
  generation.speed = 1.0f;
  generation.silence_scale = 0.2f;
  for (int i = 0; i < count; i++) {
    fprintf(stderr, "line %d/%d\n", i + 1, count);
    const SherpaOnnxGeneratedAudio *audio =
        SherpaOnnxOfflineTtsGenerateWithConfig(tts, lines[i], &generation, NULL, NULL);
    if (!audio) {
      fprintf(stderr, "could not speak line %d\n", i + 1);
      return 1;
    }
    rate = audio->sample_rate;
    long pause = (long)(PAUSE_SECONDS * rate);
    all = realloc(all, (total + audio->n + pause) * sizeof(float));
    printf("%.3f %.3f\n", (double)total / rate, (double)(total + audio->n) / rate);
    fflush(stdout);
    memcpy(all + total, audio->samples, audio->n * sizeof(float));
    memset(all + total + audio->n, 0, pause * sizeof(float));
    total += audio->n + pause;
    SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
  }
  if (!SherpaOnnxWriteWave(all, total, rate, argv[2])) {
    fprintf(stderr, "could not write %s\n", argv[2]);
    return 1;
  }
  SherpaOnnxDestroyOfflineTts(tts);
  return 0;
}
