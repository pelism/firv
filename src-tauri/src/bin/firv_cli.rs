use clap::{Args, Parser, Subcommand};
use std::collections::HashMap;

#[derive(Parser, Debug)]
#[command(name = "firv-cli")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "firv command-line utilities")]
struct Cli {
    /// Workspace path containing firv.yaml.
    #[arg(long, global = true)]
    workspace: Option<String>,

    /// Enable debug logging for the MCP server.
    #[arg(long, global = true)]
    debug: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Start the headless MCP server over stdio.
    Mcp,
    /// Run a single persisted HTTP request.
    Run(RunArgs),
    /// Inspect workspace structure.
    Show(ShowArgs),
}

#[derive(Args, Debug)]
struct RunArgs {
    /// Request ID to run (matches requests/<id>.yaml).
    #[arg(long)]
    request: String,

    /// Input variable override, e.g. --input var=1. Can be repeated.
    #[arg(long, value_parser = parse_key_value)]
    input: Vec<(String, String)>,
}

#[derive(Args, Debug)]
struct ShowArgs {
    #[command(subcommand)]
    command: ShowCommands,
}

#[derive(Subcommand, Debug)]
enum ShowCommands {
    /// List all folders in the workspace sidebar.
    Folders,
    /// List HTTP requests, optionally filtered to a folder.
    Requests(ShowRequestsArgs),
}

#[derive(Args, Debug)]
struct ShowRequestsArgs {
    /// Folder path, e.g. "Folder/Subfolder". Lists all requests if omitted.
    #[arg(long)]
    folder: Option<String>,
}

fn parse_key_value(s: &str) -> Result<(String, String), String> {
    let (key, value) = s
        .split_once('=')
        .ok_or_else(|| format!("Input must be KEY=VALUE: {}", s))?;
    Ok((key.to_string(), value.to_string()))
}

fn main() {
    let cli = Cli::parse();

    let workspace = cli.workspace.clone().unwrap_or_else(|| {
        eprintln!("--workspace is required");
        std::process::exit(1);
    });
    let debug = cli.debug;

    match cli.command {
        Commands::Mcp => {
            if let Err(e) = firv_lib::mcp_server::run_server(workspace, debug) {
                eprintln!("MCP server error: {}", e);
                std::process::exit(1);
            }
        }
        Commands::Run(args) => {
            if let Err(e) = run_request_cli(&workspace, args) {
                eprintln!("Run failed: {}", e);
                std::process::exit(1);
            }
        }
        Commands::Show(args) => {
            if let Err(e) = show_cli(&workspace, args) {
                eprintln!("Show failed: {}", e);
                std::process::exit(1);
            }
        }
    }
}

fn run_request_cli(workspace_root: &str, args: RunArgs) -> Result<(), String> {
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|e| format!("Failed to create Tokio runtime: {}", e))?;
    let result = runtime.block_on(async_run_request(workspace_root, args))?;
    print_json(&result)?;

    let failed = result
        .response
        .as_ref()
        .map(|r| r.status >= 400)
        .unwrap_or(true);
    if failed {
        std::process::exit(1);
    }
    Ok(())
}

async fn async_run_request(
    workspace_root: &str,
    args: RunArgs,
) -> Result<firv_lib::request_engine::LifecycleResult, String> {
    let workspace =
        firv_lib::workspace_context::WorkspaceContext::load(workspace_root.to_string())?;
    let overrides: HashMap<String, String> = args.input.into_iter().collect();

    firv_lib::request_engine::run_request_by_id_with_overrides(
        workspace_root,
        &args.request,
        workspace.workspace_vars(),
        workspace.environment_vars(),
        workspace.secrets(),
        overrides,
    )
    .await
}

fn show_cli(workspace_root: &str, args: ShowArgs) -> Result<(), String> {
    let workspace =
        firv_lib::workspace_context::WorkspaceContext::load(workspace_root.to_string())?;
    let manifest = workspace.manifest();

    match args.command {
        ShowCommands::Folders => {
            let folders = collect_folders(&manifest.workspace.order, Vec::new());
            print_json(&folders)?;
        }
        ShowCommands::Requests(req_args) => {
            let requests = collect_requests(&manifest.workspace.order, Vec::new());
            match req_args.folder {
                Some(folder_path) => {
                    let folder_exists =
                        folders_include(&manifest.workspace.order, &folder_path, Vec::new());
                    if !folder_exists {
                        return Err(format!("Folder '{}' not found", folder_path));
                    }
                    let filtered: Vec<_> = requests
                        .into_iter()
                        .filter(|r| r.folder.as_deref() == Some(&folder_path))
                        .collect();
                    print_json(&filtered)?;
                }
                None => print_json(&requests)?,
            }
        }
    }
    Ok(())
}

fn print_json<T: serde::Serialize>(value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    println!("{}", json);
    Ok(())
}

#[derive(serde::Serialize)]
struct FolderInfo {
    path: String,
    name: String,
}

#[derive(serde::Serialize)]
struct RequestInfo {
    id: String,
    name: String,
    method: String,
    folder: Option<String>,
}

fn collect_folders(
    items: &[firv_lib::models::manifest::SidebarItem],
    path: Vec<String>,
) -> Vec<FolderInfo> {
    let mut result = Vec::new();
    for item in items {
        if let firv_lib::models::manifest::SidebarItem::Folder {
            name,
            items: children,
        } = item
        {
            let mut folder_path = path.clone();
            folder_path.push(name.clone());
            result.push(FolderInfo {
                path: folder_path.join("/"),
                name: name.clone(),
            });
            result.extend(collect_folders(children, folder_path));
        }
    }
    result
}

fn folders_include(
    items: &[firv_lib::models::manifest::SidebarItem],
    target: &str,
    path: Vec<String>,
) -> bool {
    for item in items {
        if let firv_lib::models::manifest::SidebarItem::Folder {
            name,
            items: children,
        } = item
        {
            let mut folder_path = path.clone();
            folder_path.push(name.clone());
            if folder_path.join("/") == target {
                return true;
            }
            if folders_include(children, target, folder_path) {
                return true;
            }
        }
    }
    false
}

fn collect_requests(
    items: &[firv_lib::models::manifest::SidebarItem],
    path: Vec<String>,
) -> Vec<RequestInfo> {
    let mut result = Vec::new();
    for item in items {
        match item {
            firv_lib::models::manifest::SidebarItem::Request { id, name, method } => {
                result.push(RequestInfo {
                    id: id.clone(),
                    name: name.clone(),
                    method: format!("{:?}", method),
                    folder: if path.is_empty() {
                        None
                    } else {
                        Some(path.join("/"))
                    },
                });
            }
            firv_lib::models::manifest::SidebarItem::Folder {
                name,
                items: children,
            } => {
                let mut child_path = path.clone();
                child_path.push(name.clone());
                result.extend(collect_requests(children, child_path));
            }
            _ => {}
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use firv_lib::models::manifest::SidebarItem;
    use firv_lib::models::request::HttpMethod;

    fn sample_sidebar() -> Vec<SidebarItem> {
        vec![
            SidebarItem::Request {
                id: "root-req".to_string(),
                name: "Root Request".to_string(),
                method: HttpMethod::GET,
            },
            SidebarItem::Folder {
                name: "API".to_string(),
                items: vec![
                    SidebarItem::Folder {
                        name: "v1".to_string(),
                        items: vec![SidebarItem::Request {
                            id: "nested-req".to_string(),
                            name: "Nested Request".to_string(),
                            method: HttpMethod::POST,
                        }],
                    },
                    SidebarItem::Request {
                        id: "api-req".to_string(),
                        name: "API Request".to_string(),
                        method: HttpMethod::PUT,
                    },
                ],
            },
        ]
    }

    #[test]
    fn parse_key_value_splits_at_first_equals() {
        assert_eq!(
            parse_key_value("var=1").unwrap(),
            ("var".to_string(), "1".to_string())
        );
    }

    #[test]
    fn parse_key_value_rejects_missing_equals() {
        assert!(parse_key_value("novalue").is_err());
    }

    #[test]
    fn collect_folders_returns_nested_paths() {
        let folders = collect_folders(&sample_sidebar(), Vec::new());
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0].path, "API");
        assert_eq!(folders[1].path, "API/v1");
    }

    #[test]
    fn collect_requests_flattens_all_http_requests() {
        let requests = collect_requests(&sample_sidebar(), Vec::new());
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].id, "root-req");
        assert_eq!(requests[0].folder, None);
        assert_eq!(requests[1].id, "nested-req");
        assert_eq!(requests[1].folder, Some("API/v1".to_string()));
        assert_eq!(requests[2].id, "api-req");
        assert_eq!(requests[2].folder, Some("API".to_string()));
    }

    #[test]
    fn folders_include_matches_nested_path() {
        let items = sample_sidebar();
        assert!(folders_include(&items, "API", Vec::new()));
        assert!(folders_include(&items, "API/v1", Vec::new()));
        assert!(!folders_include(&items, "Missing", Vec::new()));
    }

    #[test]
    fn parse_key_value_preserves_value_with_equals() {
        assert_eq!(
            parse_key_value("query=select * from users").unwrap(),
            ("query".to_string(), "select * from users".to_string())
        );
    }

    #[test]
    fn collect_requests_skips_non_http_items() {
        let items = vec![
            SidebarItem::Request {
                id: "http-req".to_string(),
                name: "HTTP".to_string(),
                method: HttpMethod::GET,
            },
            SidebarItem::Ws {
                id: "ws-req".to_string(),
                name: "WS".to_string(),
            },
            SidebarItem::Grpc {
                id: "grpc-req".to_string(),
                name: "gRPC".to_string(),
            },
            SidebarItem::Flow {
                id: "flow-req".to_string(),
                name: "Flow".to_string(),
            },
        ];
        let requests = collect_requests(&items, Vec::new());
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].id, "http-req");
    }
}
