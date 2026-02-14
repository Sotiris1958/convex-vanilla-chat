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

    // group: messageId -> emoji -> count + mine
    const identity = await ctx.auth.getUserIdentity();
    const me = identity?.subject ?? null;

    const byMsg: Record<string, Record<string, { count: number; mine: boolean }>> = {};

    for (const r of rows) {
      const mid = r.messageId;
      const midKey = mid.toString();
      byMsg[midKey] ??= {};
      byMsg[midKey][r.emoji] ??= { count: 0, mine: false };
      byMsg[midKey][r.emoji].count += 1;
      if (me && r.userId === me) byMsg[midKey][r.emoji].mine = true;
    }

    return byMsg;
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
      await ctx.db.delete(existing._id); // toggle off
      return { on: false };
    } else {
      await ctx.db.insert("reactions", { messageId: args.messageId, room, userId, emoji });
      return { on: true };
    }
  },
});
