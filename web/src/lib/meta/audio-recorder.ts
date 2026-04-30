const WAV_MIME_TYPE = "audio/wav";
const DEFAULT_BUFFER_SIZE = 4096;

type RecorderSession = {
  cancel: () => Promise<void>;
  stop: () => Promise<File>;
};

function getAudioContextConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext ||
    null
  );
}

function mergeChannels(chunks: Float32Array[], totalLength: number) {
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function mixToMono(inputBuffer: AudioBuffer) {
  if (inputBuffer.numberOfChannels === 1) {
    return new Float32Array(inputBuffer.getChannelData(0));
  }

  const frameLength = inputBuffer.length;
  const mixed = new Float32Array(frameLength);

  for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
    let sample = 0;

    for (
      let channelIndex = 0;
      channelIndex < inputBuffer.numberOfChannels;
      channelIndex += 1
    ) {
      sample += inputBuffer.getChannelData(channelIndex)[frameIndex] ?? 0;
    }

    mixed[frameIndex] = sample / inputBuffer.numberOfChannels;
  }

  return mixed;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: WAV_MIME_TYPE });
}

export async function startInstagramAudioRecording(): Promise<RecorderSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador no permite grabar audio.");
  }

  const AudioContextConstructor = getAudioContextConstructor();

  if (!AudioContextConstructor) {
    throw new Error("Este navegador no soporta grabacion de audio.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContextConstructor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(
    DEFAULT_BUFFER_SIZE,
    source.channelCount || 1,
    1,
  );
  const chunks: Float32Array[] = [];
  let totalLength = 0;
  let cleanedUp = false;

  source.connect(processor);
  processor.connect(audioContext.destination);
  await audioContext.resume().catch(() => undefined);

  processor.onaudioprocess = (event) => {
    const monoChunk = mixToMono(event.inputBuffer);
    chunks.push(monoChunk);
    totalLength += monoChunk.length;
  };

  async function cleanup() {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close().catch(() => undefined);
  }

  return {
    async cancel() {
      await cleanup();
    },
    async stop() {
      await cleanup();

      if (totalLength === 0) {
        throw new Error("La grabacion quedo vacia.");
      }

      const samples = mergeChannels(chunks, totalLength);
      const blob = encodeWav(samples, audioContext.sampleRate);

      return new File([blob], `automation-${Date.now()}.wav`, {
        type: WAV_MIME_TYPE,
      });
    },
  };
}
