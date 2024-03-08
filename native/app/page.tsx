"use client";

import React from "react";
import { runCommand } from "@/components/handlers";

export default function Home() {
  const [text, setText] = React.useState("");

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      Hello World
      <input
        className="text-black"
        value={text}
        onChange={(evt) => setText(evt.target.value)}
      />
      <button
        onClick={() => {
          console.log("hello");
          runCommand({
            kind: { kind: "Shell", working_directory: "/" },
            source: text,
          });
        }}
      >
        Submit
      </button>
    </main>
  );
}
