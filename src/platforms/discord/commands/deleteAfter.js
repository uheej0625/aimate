import { ApplicationCommandType, MessageFlags } from "discord.js";

/** 대상 메세지 포함, 이후의 모든 메세지를 수집합니다 */
async function fetchMessagesFromTarget(channel, targetMessage) {
  const collected = new Map();
  let lastId = null;

  while (true) {
    const fetched = await channel.messages.fetch({
      after: lastId ?? targetMessage.id,
      limit: 100,
    });
    if (!fetched.size) break;

    for (const [id, msg] of fetched) collected.set(id, msg);
    lastId = fetched.last().id;

    // Discord 스노우플레이크는 오름차순이므로 100개 미만이면 끝
    if (fetched.size < 100) break;
  }

  collected.set(targetMessage.id, targetMessage);
  return [...collected.values()];
}

/** 메세지 하나를 개별 삭제하고 결과를 반환합니다 */
async function deleteSingle(msg) {
  try {
    await msg.delete();
    return "deleted";
  } catch (e) {
    // DM 채널에서 상대방 메세지는 삭제 불가 (Discord API 제한)
    if (e.code === 50003) return "skipped";
    console.error(`❌ 개별 삭제 실패 (${msg.id}):`, e);
    return "failed";
  }
}

/** 메세지 목록을 Discord에서 삭제하고 { deleted, skipped, failed } 카운트를 반환합니다 */
async function deleteDiscordMessages(channel, messages) {
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  const countResult = (result) => {
    if (result === "deleted") deleted++;
    else if (result === "skipped") skipped++;
    else failed++;
  };

  if (typeof channel.bulkDelete === "function") {
    // bulkDelete: filterOld=true로 14일 이상 된 메세지는 자동 제외됨 (Discord API 제한)
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const result = await channel.bulkDelete(batch, true);
        deleted += result.size;
        // bulkDelete에서 제외된 오래된 메세지는 개별 삭제
        for (const msg of batch) {
          if (!result.has(msg.id)) countResult(await deleteSingle(msg));
        }
      } catch (error) {
        console.error("❌ bulkDelete 실패, 개별 삭제로 전환:", error);
        for (const msg of batch) countResult(await deleteSingle(msg));
      }
    }
  } else {
    for (const msg of messages) countResult(await deleteSingle(msg));
  }

  return { deleted, skipped, failed };
}

function buildResultMessage({ total, deleted, skipped, failed, dbDeleted }) {
  const lines = [
    `✅ ${deleted}개 메세지를 삭제했습니다. (DB ${dbDeleted}개 삭제)`,
  ];
  if (skipped > 0)
    lines.push(`ℹ️ ${skipped}개의 본인이 보낸 메세지는 직접 삭제해 주세요.`);
  if (failed > 0)
    lines.push(`⚠️ ${failed}개 메세지는 권한 문제로 삭제하지 못했습니다.`);
  if (total > deleted + skipped + failed)
    lines.push(`⚠️ 일부 메세지를 불러오지 못했을 수 있습니다.`);
  return lines.join("\n");
}

export default {
  data: {
    name: "이 이후 메세지 삭제",
    type: ApplicationCommandType.Message,
  },
  /**
   * 대상 메세지 포함, 이후의 모든 메세지를 삭제합니다
   * @param {import("discord.js").MessageContextMenuCommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // partial 채널은 bulkDelete가 없으므로 fetch로 완전한 객체를 가져옴
    const channel = await interaction.client.channels.fetch(
      interaction.channelId,
    );
    const { messageRepository } = interaction.client.services;

    const messages = await fetchMessagesFromTarget(
      channel,
      interaction.targetMessage,
    );
    const { deleted, skipped, failed } = await deleteDiscordMessages(
      channel,
      messages,
    );

    const dbDeleted = await messageRepository.deleteManyByPlatformIds(
      "discord",
      messages.map((m) => m.id),
    );

    await interaction.editReply({
      content: buildResultMessage({
        total: messages.length,
        deleted,
        skipped,
        failed,
        dbDeleted,
      }),
    });
  },
};
