// Decode ADTS AAC frames [from, to) with Fraunhofer FDK-AAC (Android's platform AAC decoder) from
// a fresh decoder, writing interleaved int16 PCM for frames [keep, to) to stdout.
//   fdkrange <file.adts> <from> <keep> <to> [limiter 0|1]
// Built against mstorsjo/fdk-aac: see ../README.md.
#include <stdio.h>
#include <stdlib.h>
#include <aacdecoder_lib.h>

int main(int argc, char **argv) {
	if (argc < 5) { fprintf(stderr, "usage: fdkrange file.adts from keep to [limiter]\n"); return 2; }
	FILE *f = fopen(argv[1], "rb");
	long from = atol(argv[2]), keep = atol(argv[3]), to = atol(argv[4]);
	int limiter = argc > 5 ? atoi(argv[5]) : -1;
	fseek(f, 0, SEEK_END); long size = ftell(f); fseek(f, 0, SEEK_SET);
	unsigned char *buf = malloc(size); fread(buf, 1, size, f); fclose(f);
	HANDLE_AACDECODER dec = aacDecoder_Open(TT_MP4_ADTS, 1);
	if (limiter >= 0) aacDecoder_SetParam(dec, AAC_PCM_LIMITER_ENABLE, limiter);
	INT_PCM pcm[8 * 2048];
	long pos = 0, frame = 0;
	while (pos + 7 <= size && frame < to) {
		unsigned char *h = buf + pos;
		if (h[0] != 0xFF || (h[1] & 0xF0) != 0xF0) { fprintf(stderr, "lost sync at %ld\n", pos); return 1; }
		UINT len = ((h[3] & 3) << 11) | (h[4] << 3) | (h[5] >> 5);
		if (frame >= from) {
			UCHAR *p = h; UINT n = len, valid = len;
			if (aacDecoder_Fill(dec, &p, &n, &valid) != AAC_DEC_OK) { fprintf(stderr, "fill\n"); return 1; }
			AAC_DECODER_ERROR e = aacDecoder_DecodeFrame(dec, pcm, sizeof pcm / sizeof *pcm, 0);
			if (e != AAC_DEC_OK) { fprintf(stderr, "decode error %x at frame %ld\n", e, frame); return 1; }
			CStreamInfo *info = aacDecoder_GetStreamInfo(dec);
			if (frame >= keep) fwrite(pcm, sizeof(INT_PCM), info->frameSize * info->numChannels, stdout);
		}
		pos += len; frame++;
	}
	aacDecoder_Close(dec);
	return 0;
}
