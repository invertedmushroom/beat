export type MediaTrack = { stop(): void };
export type MediaStream = { getTracks(): readonly MediaTrack[] };
export type CameraPort = {
  request(): Promise<MediaStream>;
  attach(stream: MediaStream): Promise<void>;
  detach(): void;
};

export function createCamera(port: CameraPort, report: (message: string) => void) {
  let stream: MediaStream | undefined;

  function stop() {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = undefined;
    port.detach();
  }

  return {
    async start(): Promise<void> {
      try {
        stream = await port.request();
        await port.attach(stream);
      } catch {
        report('Camera startup failed.');
      }
    },
    stop,
    dispose: stop,
  };
}
