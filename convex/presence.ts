import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const ONLINE_WINDOW_MS = 90_000; // 90 seconds (more reliable on real browsers)

export const heartbeat = mutation({
  args: { room: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const room = args.room.trim() || "general";
    const userId = identity.subject;
    const name = identity.name || identity.email || identity.nickname || "User";
    const sessionId = args.sessionId;

    const now = Date.now();

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_room_user_session", (q) =>
        q.eq("room", room).eq("userId", userId).eq("sessionId", sessionId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { name, lastSeen: now });
    } else {
      await ctx.db.insert("presence", { room, userId, name, sessionId, lastSeen: now });
    }
  },
});

export const leave = mutation({
  args: { room: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return;

    const room = args.room.trim() || "general";
    const userId = identity.subject;
    const sessionId = args.sessionId;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_room_user_session", (q) =>
        q.eq("room", room).eq("userId", userId).eq("sessionId", sessionId)
      )
      .unique();

    if (existing) await ctx.db.delete(existing._id);
  },
});

export const listOnlineByRoom = query({
  args: { room: v.string() },
  handler: async (ctx, args) => {
    const room = args.room.trim() || "general";
    const now = Date.now();

    const rows = await ctx.db
      .query("presence")
      .withIndex("by_room", (q) => q.eq("room", room))
      .collect();

    const active = rows.filter((p) => now - p.lastSeen <= ONLINE_WINDOW_MS);

    // ✅ Return UNIQUE USERS in this room (not tabs/sessions)
    const byUser = new Map<string, { userId: string; name: string }>();
    for (const p of active) {
      if (!byUser.has(p.userId)) byUser.set(p.userId, { userId: p.userId, name: p.name });
    }
    return Array.from(byUser.values());
  },
});
