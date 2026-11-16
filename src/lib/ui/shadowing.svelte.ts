/**
 * One take of the reader shadowing a line: recorded in memory, played back, thrown away when the
 * line changes or the page closes. Never stored, never sent (docs/shadowing-recording-spec.md).
 * The microphone is held only while recording, so its indicator is off the rest of the time.
 */
export class ShadowTake {
	state = $state<'idle' | 'starting' | 'recording' | 'recorded'>('idle');
	error = $state('');
	playing = $state(false);

	#stream: MediaStream | null = null;
	#recorder: MediaRecorder | null = null;
	#url = '';
	#audio: HTMLAudioElement | null = null;
	/** Bumped by discard(), so a start still waiting on the permission prompt gives up. */
	#generation = 0;

	/** Resolves true once recording, false if the microphone was refused or is missing. */
	async start(): Promise<boolean> {
		this.discard();
		const generation = this.#generation;
		this.state = 'starting';
		let stream: MediaStream;
		try {
			// Echo cancellation put Android in call mode, which silenced the video while recording
			// (measured 2026-11-16: MODE_IN_COMMUNICATION with it, MODE_NORMAL without). On the
			// speaker the video is in the take too; with headphones it is not.
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
			});
		} catch (e) {
			if (generation !== this.#generation) return false;
			this.state = 'idle';
			this.error =
				e instanceof DOMException && e.name === 'NotAllowedError'
					? 'Microphone not allowed'
					: 'No microphone';
			return false;
		}
		if (generation !== this.#generation) {
			stream.getTracks().forEach((t) => t.stop());
			return false;
		}
		const chunks: Blob[] = [];
		const recorder = new MediaRecorder(stream);
		recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
		recorder.onstop = () => {
			stream.getTracks().forEach((t) => t.stop());
			if (generation !== this.#generation || !chunks.length) return;
			this.#url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
			this.state = 'recorded';
		};
		this.#stream = stream;
		this.#recorder = recorder;
		recorder.start();
		this.state = 'recording';
		return true;
	}

	/** Keeps what was recorded so far. */
	stop() {
		if (this.#recorder?.state === 'recording') this.#recorder.stop();
		this.#recorder = null;
		this.#stream = null;
	}

	play() {
		if (!this.#url) return;
		this.#audio?.pause();
		const audio = new Audio(this.#url);
		audio.onended = audio.onpause = () => (this.playing = false);
		this.#audio = audio;
		this.playing = true;
		void audio.play().catch(() => (this.playing = false));
	}

	discard() {
		this.#generation++;
		if (this.#recorder?.state === 'recording') this.#recorder.stop();
		this.#stream?.getTracks().forEach((t) => t.stop());
		this.#recorder = null;
		this.#stream = null;
		this.#audio?.pause();
		this.#audio = null;
		if (this.#url) URL.revokeObjectURL(this.#url);
		this.#url = '';
		this.state = 'idle';
		this.playing = false;
		this.error = '';
	}
}
