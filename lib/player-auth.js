import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPlayerToken } from "@/lib/player-tokens.mjs";

export const PLAYER_COOKIE = "ruvanas_player";
const PLAYER_SESSION_DAYS = 180;

function playerSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }

  return secret;
}

export function playerTokenHash(token) {
  return hashPlayerToken(token, playerSecret());
}

export function setPlayerCookie(token) {
  cookies().set(PLAYER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: PLAYER_SESSION_DAYS * 24 * 60 * 60,
    path: "/"
  });
}

export async function getCurrentPlayer() {
  const token = cookies().get(PLAYER_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return prisma.player.findUnique({
    where: { sessionTokenHash: playerTokenHash(token) },
    include: {
      zone: {
        include: {
          location: {
            include: {
              openingHours: true,
              openingExceptions: true
            }
          },
          channelAssignments: {
            where: {
              activeFrom: { lte: new Date() },
              OR: [{ activeTo: null }, { activeTo: { gt: new Date() } }]
            },
            orderBy: { activeFrom: "desc" },
            take: 1,
            include: {
              channel: {
                include: {
                  station: { include: { streamConfig: true } }
                }
              }
            }
          }
        }
      }
    }
  });
}
