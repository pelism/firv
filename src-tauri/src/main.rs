// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "firv")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "A cross-platform desktop HTTP client with agent MCP support")]
struct Cli {
    /// Optional workspace path to open in the GUI or MCP server.
    #[arg(long, global = true)]
    workspace: Option<String>,

    /// Enable debug logging for the MCP server.
    #[arg(long, global = true)]
    debug: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Start the headless MCP server over stdio.
    Mcp,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Mcp) => {
            let workspace = cli.workspace.unwrap_or_else(|| {
                eprintln!("--workspace is required for mcp mode");
                std::process::exit(1);
            });
            if let Err(e) = firv_lib::mcp_server::run_server(workspace, cli.debug) {
                eprintln!("MCP server error: {}", e);
                std::process::exit(1);
            }
        }
        None => {
            firv_lib::run_with_project(cli.workspace)
        }
    }
}
