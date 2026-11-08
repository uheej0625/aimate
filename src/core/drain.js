/** Bound shutdown even if a transport or model ignores cancellation. */
export async function drain(work, timeoutMs = 5000) {
  let timer;
  try {
    await Promise.race([
      Promise.allSettled([...work]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
