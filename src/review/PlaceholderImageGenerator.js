/** Executes the real image tool pipeline without an image provider request. */
export class PlaceholderImageGenerator {
  async generate(_prompt, { abortSignal } = {}) {
    abortSignal?.throwIfAborted();
    return {
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
      request: { mode: "review_placeholder", imageAiCalled: false },
      response: { mode: "review_placeholder", imageAiCalled: false },
    };
  }
}
