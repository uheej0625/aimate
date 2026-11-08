/** SQLite is the local CLI platform's source of truth, read on explicit UI channel access. */
export async function readCliHistory(
  messageRepository,
  platformChannelId,
  { limit, before },
) {
  const messages = await messageRepository.getHistoryByPlatformChannelId(
    "cli",
    platformChannelId,
    limit,
    before,
  );
  return messages
    .filter((message) => message.author)
    .map((message) => ({
      platform: "cli",
      platformMessageId: message.platformId,
      platformChannelId,
      platformServerId: null,
      content: message.content,
      attachments: JSON.parse(message.attachmentsJson ?? "[]"),
      sentAt: message.sentAt,
      editedAt: message.editedAt,
      author: {
        platformUserId: message.author.platformId,
        handle: message.author.handle,
        displayName: message.author.displayName,
        isBot: message.isBot,
      },
    }));
}
