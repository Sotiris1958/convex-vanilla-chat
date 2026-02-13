import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const TYPING_WINDOW_MS = 4_000; // show "typing" if seen within last 4s

export const ping = mutation({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const room = args.room.trim() || "general";
    const userId = identity.subject;
    const name = identity.name || identity.email || identity.nickname || "User";
    const now = Date.now();

    const existing = await ctx.db
      .query("typing")
      .withIndex("by_room_user", (q) => q.eq("room", room).eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { name, lastTyped: now });
    } else {
      await ctx.db.insert("typing", { room, userId, name, lastTyped: now });
    }
  },
});

export const stop = mutation({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;

    const room = args.room.trim() || "general";
    const userId = identity.subject;

    const existing = await ctx.db
      .query("typing")
      .withIndex("by_room_user", (q) => q.eq("room", room).eq("userId", userId))
      .unique();

    if (existing) await ctx.db.delete(existing._id);
  },
});

export const listByRoom = query({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const room = args.room.trim() || "general";
    const now = Date.now();

    const rows = await ctx.db
      .query("typing")
      .withIndex("by_room", (q) => q.eq("room", room))
      .collect();

    // Only show active typers (auto-expire)
    return rows
      .filter((t) => now - t.lastTyped <= TYPING_WINDOW_MS)
      .map((t) => ({ userId: t.userId, name: t.name }));
  },
});
