import { v4 as uuid } from "uuid";

/**
 *
 * @return {string} The ID to use
 */
export function getId() {
  const id = window.localStorage.getItem("peerjs-id");
  if (id === null) {
    const newId = uuid();
    window.localStorage.setItem("peerjs-id", newId);
    return newId;
  }

  return id;
}
