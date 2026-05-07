use rquickjs::{Ctx, Function, Object, Result, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use crate::lifecycle::HydratedRequestInfo;
use crate::runner::{FirvResponse, CLIENT};
use serde_json;

pub struct ScriptState {
    pub workspace_vars: Arc<Mutex<HashMap<String, String>>>,
    pub request_vars: Arc<Mutex<HashMap<String, String>>>,
    pub logs: Arc<Mutex<Vec<String>>>,
}

fn send_request_sync(
    url: String,
    method: String,
    body: Option<String>,
    headers_json: String,
) -> Result<String> {
    let headers: HashMap<String, String> = serde_json::from_str(&headers_json).unwrap_or_default();
    let client = CLIENT.clone();
    let handle = tokio::runtime::Handle::current();
    
    let res = handle.block_on(async move {
        let mut req_builder = client.request(
            reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET),
            &url
        );
        for (k, v) in headers {
            req_builder = req_builder.header(k, v);
        }
        if let Some(body_str) = body {
            req_builder = req_builder.body(body_str);
        }
        req_builder.send().await
    });
    
    match res {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body_text = handle.block_on(async { resp.text().await.unwrap_or_default() });
            let mut map = HashMap::new();
            map.insert("status", status.to_string());
            map.insert("body", body_text);
            Ok(serde_json::to_string(&map).unwrap_or_default())
        }
        Err(e) => {
            Err(rquickjs::Error::new_loading_message("sendRequest", e.to_string()))
        }
    }
}

pub fn setup_firv_api<'js>(
    ctx: &Ctx<'js>,
    state: Arc<ScriptState>,
    request: Option<Arc<Mutex<HydratedRequestInfo>>>,
    response: Option<Arc<FirvResponse>>,
) -> Result<()> {
    let globals = ctx.globals();
    let firv = Object::new(ctx.clone())?;

    // --- Logging ---
    let logs_arc = Arc::clone(&state.logs);
    firv.set(
        "log",
        Function::new(ctx.clone(), move |val: Value| {
            let msg = if val.is_object() {
                " [Object] ".to_string() 
            } else {
                val.as_string().map(|s| s.to_string().unwrap_or_default()).unwrap_or_else(|| format!("{:?}", val))
            };
            logs_arc.lock().unwrap().push(msg);
        })?,
    )?;

    // --- Workspace Object ---
    let workspace = Object::new(ctx.clone())?;
    let ws_get_vars = Arc::clone(&state.workspace_vars);
    workspace.set(
        "getVar",
        Function::new(ctx.clone(), move |key: String| {
            ws_get_vars.lock().unwrap().get(&key).cloned().unwrap_or_default()
        })?,
    )?;

    let ws_set_vars = Arc::clone(&state.workspace_vars);
    workspace.set(
        "setVar",
        Function::new(ctx.clone(), move |key: String, val: String| {
            ws_set_vars.lock().unwrap().insert(key, val);
        })?,
    )?;
    firv.set("workspace", workspace)?;

    // --- Request Object (Variables & Hydrated Info) ---
    let req_obj = Object::new(ctx.clone())?;
    
    // Request Variables
    let req_get_vars = Arc::clone(&state.request_vars);
    req_obj.set(
        "getVar",
        Function::new(ctx.clone(), move |key: String| {
            req_get_vars.lock().unwrap().get(&key).cloned().unwrap_or_default()
        })?,
    )?;

    let req_set_vars = Arc::clone(&state.request_vars);
    req_obj.set(
        "setVar",
        Function::new(ctx.clone(), move |key: String, val: String| {
            req_set_vars.lock().unwrap().insert(key, val);
        })?,
    )?;

    // Hydrated Request Info (url, method, headers, body)
    if let Some(hydrated_req) = request {
        let req_url_get = Arc::clone(&hydrated_req);
        req_obj.set("__get_url", Function::new(ctx.clone(), move || {
            req_url_get.lock().unwrap().url.clone()
        })?)?;
        let req_url_set = Arc::clone(&hydrated_req);
        req_obj.set("__set_url", Function::new(ctx.clone(), move |val: String| {
            req_url_set.lock().unwrap().url = val;
        })?)?;

        let req_method_get = Arc::clone(&hydrated_req);
        req_obj.set("__get_method", Function::new(ctx.clone(), move || {
            req_method_get.lock().unwrap().method.clone()
        })?)?;
        let req_method_set = Arc::clone(&hydrated_req);
        req_obj.set("__set_method", Function::new(ctx.clone(), move |val: String| {
            req_method_set.lock().unwrap().method = val;
        })?)?;

        let req_body_get = Arc::clone(&hydrated_req);
        req_obj.set("__get_body", Function::new(ctx.clone(), move || {
            req_body_get.lock().unwrap().body.clone().unwrap_or_default()
        })?)?;
        let req_body_set = Arc::clone(&hydrated_req);
        req_obj.set("__set_body", Function::new(ctx.clone(), move |val: String| {
            req_body_set.lock().unwrap().body = Some(val);
        })?)?;

        ctx.eval::<(), _>(r#"
            Object.defineProperties(firv.request, {
                url: {
                    get: function() { return this.__get_url(); },
                    set: function(v) { this.__set_url(v); }
                },
                method: {
                    get: function() { return this.__get_method(); },
                    set: function(v) { this.__set_method(v); }
                },
                body: {
                    get: function() { return this.__get_body(); },
                    set: function(v) { this.__set_body(v); }
                }
            });
        "#)?;

        let headers_obj = Object::new(ctx.clone())?;
        let req_headers_set = Arc::clone(&hydrated_req);
        headers_obj.set("set", Function::new(ctx.clone(), move |key: String, val: String| {
            req_headers_set.lock().unwrap().headers.insert(key, val);
        })?)?;
        
        let req_headers_get = Arc::clone(&hydrated_req);
        headers_obj.set("get", Function::new(ctx.clone(), move |key: String| {
            req_headers_get.lock().unwrap().headers.get(&key).cloned().unwrap_or_default()
        })?)?;

        req_obj.set("headers", headers_obj)?;
    }

    firv.set("request", req_obj)?;

    // --- Response Object ---
    if let Some(resp) = response {
        let resp_obj = Object::new(ctx.clone())?;
        resp_obj.set("status", resp.status)?;
        resp_obj.set("body", resp.body.clone())?;
        
        let headers_obj = Object::new(ctx.clone())?;
        for (k, v) in &resp.headers {
            headers_obj.set(k.clone(), v.clone())?;
        }
        resp_obj.set("headers", headers_obj)?;

        let body_for_json = resp.body.clone();
        resp_obj.set("__get_body_for_json", Function::new(ctx.clone(), move || {
            body_for_json.clone()
        })?)?;

        ctx.eval::<(), _>(r#"
            firv.response.json = function() {
                return JSON.parse(this.__get_body_for_json());
            };
        "#)?;

        firv.set("response", resp_obj)?;
    }

    // --- sendRequest ---
    firv.set("__sendRequest_internal", Function::new(ctx.clone(), move |url: String, method: String, body: Option<String>, headers_json: String| {
        send_request_sync(url, method, body, headers_json)
    })?)?;

    ctx.eval::<(), _>(r#"
        firv.encodeForm = function(data) {
            return Object.keys(data)
                .map(function(key) {
                    return encodeURIComponent(key) + '=' + encodeURIComponent(data[key]);
                })
                .join('&');
        };

        firv.sendRequest = function(config) {
            var resJson = this.__sendRequest_internal(
                config.url || "",
                config.method || "GET",
                config.body || null,
                JSON.stringify(config.headers || {})
            );
            var res = JSON.parse(resJson);
            return {
                status: parseInt(res.status),
                body: res.body
            };
        };
    "#)?;

    globals.set("firv", firv)?;
    Ok(())
}
