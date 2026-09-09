"use client";

import { createContext, useContext } from "react";

export const SubscriberThemeContext = createContext("dark");

export function useSubscriberTheme() {
  return useContext(SubscriberThemeContext);
}
