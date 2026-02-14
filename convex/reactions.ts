import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listForRoom = query({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const room = args.room.trim() || "general";

    const rows = await ctx.db
      .query("reactions")
      .withIndex("by_room_message", (q) => q.eq("room", room))
      .collect();

    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.subject ?? null;

    // Aggregate by (messageId, emoji)
    const map = new Map<string, { messageId: string; emoji: string; count: number; mine: boolean }>();

    for (const r of rows) {
      const key = `${r.messageId.toString()}|${r.emoji}`;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (me && r.userId === me) existing.mine = true;
      } else {
        map.set(key, {
          messageId: r.messageId.toString(),
          emoji: r.emoji,
          count: 1,
          mine: !!(me && r.userId === me),
        });
      }
    }

    return Array.from(map.values());
  },
});

export const toggle = mutation({
  args: { messageId: v.id("messages"), room: v.string(), emoji: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const room = args.room.trim() || "general";
    const userId = identity.subject;
    const emoji = args.emoji;

    const existing = await ctx.db
      .query("reactions")
      .withIndex("by_message_user_emoji", (q) =>
        q.eq("messageId", args.messageId).eq("userId", userId).eq("emoji", emoji)
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { on: false };
    } else {
      await ctx.db.insert("reactions", { messageId: args.messageId, room, userId, emoji });
      return { on: true };
    }
  },
});
