// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import { invoke } from "@tauri-apps/api/core";

/**
 * Start scanning.
 * @param options
 */
export async function scan(): Promise<void> {
  await invoke("plugin:webb-networking|scan", {});
}
