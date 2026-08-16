use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "firv-cli")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "firv command-line utilities")]
struct Cli {
    /// Optional workspace path for the MCP server.
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
            eprintln!("No subcommand provided. Use `firv-cli mcp --workspace <PATH>` to start the MCP server.");
            std::process::exit(1);
        }
    }
}
