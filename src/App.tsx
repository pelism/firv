import { useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <h1 className="text-4xl font-bold mb-8 text-gray-900">Welcome to Tauri + React + Tailwind</h1>

      <div className="flex gap-4 mb-8">
        <a href="https://vite.dev" target="_blank" rel="noreferrer">
          <img src="/vite.svg" className="w-24 h-24 transition-transform hover:scale-110" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank" rel="noreferrer">
          <img src="/tauri.svg" className="w-24 h-24 transition-transform hover:scale-110" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="w-24 h-24 transition-transform hover:scale-110" alt="React logo" />
        </a>
      </div>
      <p className="text-gray-600 mb-8">Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit" className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors">
          Greet
        </button>
      </form>
      <p className="mt-4 text-lg font-medium text-gray-800">{greetMsg}</p>
    </main>
  );
}

export default App;

