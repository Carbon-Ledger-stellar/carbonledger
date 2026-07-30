"use client";

import { useEffect } from "react";
import { initGlobalErrorHandlers } from "../lib/logger";

export default function GlobalErrorInit() {
  useEffect(() => {
    initGlobalErrorHandlers();
  }, []);
  return null;
}
