import { createHash } from "node:crypto";

/** Resolves fixed channel references and records confirmed platform actions. */
export class MessageActionService {
  constructor({
    messageRepository,
    messageService,
    generationRepository,
    actionRepository,
  }) {
    Object.assign(this, {
      messageRepository,
      messageService,
      generationRepository,
      actionRepository,
    });
    this.inFlight = new Map();
  }

  reply({ targetMessageNo, text }, context) {
    if (typeof text !== "string" || !text.trim() || text.length > 2000)
      throw new Error("Reply text must contain 1–2000 characters.");
    return this.execute("reply", targetMessageNo, text, context);
  }

  react({ targetMessageNo, emoji }, context) {
    if (typeof emoji !== "string" || !emoji.trim() || emoji.length > 100)
      throw new Error("A reaction emoji is required (up to 100 characters).");
    return this.execute("react", targetMessageNo, emoji, context);
  }

  execute(action, targetMessageNo, value, context) {
    if (!Number.isSafeInteger(targetMessageNo) || targetMessageNo < 1)
      throw new Error("targetMessageNo must be a positive integer.");
    const { channel, channelPort, generationId } = context;
    if (
      !channel ||
      !channelPort ||
      !generationId ||
      channel.platform !== channelPort.platform ||
      channel.platformId !== channelPort.platformChannelId
    )
      throw new Error(
        "Message actions require the active channel and chat generation.",
      );
    if (typeof channelPort[action] !== "function")
      throw new Error(`This channel does not support ${action}.`);
    const key = createHash("sha256")
      .update(JSON.stringify([action, targetMessageNo, value]))
      .digest("hex");
    const executionKey = `${generationId}:${key}`;
    if (this.inFlight.has(executionKey)) return this.inFlight.get(executionKey);
    const execution = this.perform(
      action,
      targetMessageNo,
      value,
      key,
      context,
    ).finally(() => this.inFlight.delete(executionKey));
    this.inFlight.set(executionKey, execution);
    return execution;
  }

  async perform(action, targetMessageNo, value, key, context) {
    const { channel, channelPort, generationId, delivery, abortSignal } =
      context;
    const run = delivery?.run ?? ((operation) => operation());
    const isCurrent = () =>
      !abortSignal?.aborted && (delivery?.isCurrent?.() ?? true);
    const started = await run(async () => {
      if (!isCurrent()) throw new Error("The chat generation was cancelled.");
      const generation = await this.generationRepository.findById(generationId);
      if (
        generation?.status !== "PROCESSING" ||
        generation.channelId !== channel.id ||
        generation.characterId !== context.characterId
      )
        throw new Error("The chat generation is no longer active.");
      const claim = await this.actionRepository.claim(generationId, key);
      if (!claim.claimed) return claim;
      try {
        const target = await this.messageRepository.findByChannelMessageNo(
          channel.id,
          targetMessageNo,
        );
        if (
          !target ||
          target.deletedAt ||
          target.platform !== channelPort.platform
        )
          throw new Error(
            `Message #${targetMessageNo} is unavailable in the current channel.`,
          );
        const events = generation.input
          ? (JSON.parse(generation.input).eventSnapshot?.events ?? [])
          : [];
        const observed = events.some(
          (event) => event.channelMessageNo === targetMessageNo,
        );
        if (
          !observed &&
          !(target.isBot && target.generationId === generationId)
        )
          throw new Error(
            `Message #${targetMessageNo} has not been observed by this generation.`,
          );
        if (!isCurrent()) throw new Error("The chat generation was cancelled.");
        return {
          ...claim,
          // Start the external operation while owning the turn, release its queue immediately.
          dispatch:
            action === "reply"
              ? channelPort.reply(target.platformId, { content: value })
              : channelPort.react(target.platformId, value, { abortSignal }),
        };
      } catch (error) {
        await this.actionRepository.recordResult(claim.receipt.id, {
          error: error.message,
        });
        throw error;
      }
    });
    if (!started.claimed) {
      if (!started.receipt.resultJson)
        throw new Error(
          "This action was already started; its outcome is unknown. It will not be repeated.",
        );
      return this.finish(JSON.parse(started.receipt.resultJson), context, run);
    }
    let message;
    try {
      message = await started.dispatch;
    } catch (error) {
      const result = { error: error.message };
      await this.actionRepository.recordResult(started.receipt.id, result);
      return result;
    }
    const confirmed = {
      success: true,
      action,
      targetMessageNo,
      ...(action === "reply" ? { message } : { emoji: value }),
      observedAt: new Date().toISOString(),
    };
    delivery?.onDelivered?.();
    // Save the receipt first so storage can be retried without sending again.
    await this.retry(() =>
      this.actionRepository.recordResult(started.receipt.id, confirmed),
    );
    return this.finish(confirmed, context, run);
  }

  async finish(confirmed, context, run) {
    if (confirmed.error) return confirmed;
    const result = {
      success: true,
      action: confirmed.action,
      targetMessageNo: confirmed.targetMessageNo,
    };
    if (confirmed.action === "reply") {
      const { message } = await this.retry(() =>
        run(() =>
          this.messageService.saveMessage(
            confirmed.message,
            context.generationId,
            [],
            { observedAt: new Date(confirmed.observedAt) },
          ),
        ),
      );
      result.messageNo = message.channelMessageNo;
    } else {
      result.emoji = confirmed.emoji;
    }
    return result;
  }

  async retry(operation) {
    try {
      return await operation();
    } catch {
      return await operation();
    }
  }
}
