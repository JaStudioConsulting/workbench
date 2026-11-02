function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

export async function startBrowserRecording({
  includeSharedAudio = false,
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderImpl = globalThis.MediaRecorder,
} = {}) {
  if (!mediaDevices?.getUserMedia || !MediaRecorderImpl) {
    throw new Error("This browser cannot record meetings.");
  }

  const microphone = await mediaDevices.getUserMedia({ audio: true });
  let shared = null;
  try {
    if (includeSharedAudio) {
      if (!mediaDevices.getDisplayMedia) throw new Error("Shared audio is unavailable in this browser.");
      shared = await mediaDevices.getDisplayMedia({ audio: true, video: true });
    }

    const audioTracks = [
      ...microphone.getAudioTracks(),
      ...(shared?.getAudioTracks?.() || []),
    ];
    const stream = new MediaStream(audioTracks);
    const chunks = [];
    const recorder = new MediaRecorderImpl(stream, { mimeType: "audio/webm" });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.start(1000);

    return {
      stop() {
        return new Promise((resolve, reject) => {
          recorder.addEventListener("error", () => reject(new Error("Meeting recording failed.")), { once: true });
          recorder.addEventListener("stop", () => {
            stopTracks(stream);
            stopTracks(microphone);
            stopTracks(shared);
            resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
          }, { once: true });
          recorder.stop();
        });
      },
    };
  } catch (error) {
    stopTracks(microphone);
    stopTracks(shared);
    throw error;
  }
}
