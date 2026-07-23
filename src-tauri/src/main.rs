// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "firv")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "A cross-platform desktop HTTP client with agent MCP support")]
struct Cli {
    /// Optional workspace path to open in the GUI.
    #[arg(long)]
    workspace: Option<String>,
}

fn main() {
    let cli = Cli::parse();
    firv_lib::run_with_project(cli.workspace)
}
