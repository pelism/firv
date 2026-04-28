use crate::lifecycle::HydratedRequestInfo;
use crate::runner::FirvResponse;
use rquickjs::{Context, Function, Object, Runtime};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub fn execute_script(
    script: &str,
    variables: &mut HashMap<String, String>,
    request: Option<&mut HydratedRequestInfo>,
    response: Option<&FirvResponse>,
    logs: &mut Vec<String>,
) -> Result<(), String> {
    let runtime = Runtime::new().map_err(|e| e.to_string())?;
    let context = Context::full(&runtime).map_err(|e| e.to_string())?;

    let shared_vars = Arc::new(Mutex::new(variables.clone()));
    let shared_logs = Arc::new(Mutex::new(Vec::new()));

    let eval_res = context.with(|ctx| {
        let global = ctx.globals();
        let firv_obj = Object::new(ctx.clone()).unwrap();

        // 2. Add log function
        let log_arc = Arc::clone(&shared_logs);
        firv_obj
            .set(
                "__log_internal",
                Function::new(ctx.clone(), move |msg: String| {
                    log_arc.lock().unwrap().push(msg.clone());
                    println!("JS Log: {}", msg);
                })
                .unwrap(),
            )
            .unwrap();

        global.set("firv", firv_obj.clone()).unwrap();

        // Define the user-facing log function in JS
        ctx.eval::<(), _>(r#"
            firv.log = function(val) {
                let msg;
                try {
                    if (typeof val === 'object' && val !== null) {
                        msg = JSON.stringify(val);
                    } else {
                        msg = String(val);
                    }
                } catch (e) {
                    msg = "[Error formatting log]";
                }
                this.__log_internal(msg);
            };
        "#).unwrap();

        // 3. Add variable getters/setters
        let get_vars_arc = Arc::clone(&shared_vars);
        firv_obj
            .set(
                "getVar",
                Function::new(ctx.clone(), move |key: String| {
                    get_vars_arc
                        .lock()
                        .unwrap()
                        .get(&key)
                        .cloned()
                        .unwrap_or_default()
                })
                .unwrap(),
            )
            .unwrap();

        let set_vars_arc = Arc::clone(&shared_vars);
        firv_obj
            .set(
                "setVar",
                Function::new(ctx.clone(), move |key: String, val: String| {
                    set_vars_arc.lock().unwrap().insert(key, val);
                })
                .unwrap(),
            )
            .unwrap();

        // 4. Add request object if present
        if let Some(req) = request.as_ref() {
            let req_obj = Object::new(ctx.clone()).unwrap();

            req_obj.set("url", req.url.clone()).unwrap();
            req_obj.set("method", req.method.clone()).unwrap();
            req_obj.set("body", req.body.clone().unwrap_or_default()).unwrap();

            let headers_obj = Object::new(ctx.clone()).unwrap();
            for (k, v) in &req.headers {
                headers_obj.set(k.clone(), v.clone()).unwrap();
            }
            req_obj.set("headers", headers_obj).unwrap();

            firv_obj.set("request", req_obj).unwrap();
        }

        // 5. Expose response if it exists
        if let Some(resp) = response {
            let resp_obj = Object::new(ctx.clone()).unwrap();

            resp_obj.set("status", resp.status).unwrap();
            resp_obj.set("body", resp.body.clone()).unwrap();

            // Headers
            let headers_obj = Object::new(ctx.clone()).unwrap();
            for (k, v) in &resp.headers {
                headers_obj.set(k.clone(), v.clone()).unwrap();
            }
            resp_obj.set("headers", headers_obj).unwrap();

            firv_obj.set("response", resp_obj).unwrap();
        }

        global.set("firv", firv_obj.clone()).unwrap();

        // Add json() method to response if it exists
        if response.is_some() {
            ctx.eval::<(), _>(r#"
                firv.response.json = function() {
                    return JSON.parse(this.body);
                };
            "#).unwrap();
        }

        // ... run script ...
        let res = ctx.eval::<(), _>(script);

        // Sync request object back out if it was modified in JS
        if let Some(req) = request {
            if let Ok(req_obj) = firv_obj.get::<_, Object>("request") {
                if let Ok(url) = req_obj.get::<_, String>("url") {
                    req.url = url;
                }
                if let Ok(method) = req_obj.get::<_, String>("method") {
                    req.method = method;
                }
                if let Ok(body) = req_obj.get::<_, String>("body") {
                    req.body = Some(body);
                }
                if let Ok(headers_obj) = req_obj.get::<_, Object>("headers") {
                    for key in headers_obj.keys::<String>() {
                        if let Ok(k) = key {
                            if let Ok(v) = headers_obj.get::<_, String>(&k) {
                                req.headers.insert(k, v);
                            }
                        }
                    }
                }
            }
        }

        res
    });

    // Cleanup context and runtime properly to avoid GC assertion failure
    drop(context);
    for _ in 0..10 {
        runtime.run_gc();
    }
    drop(runtime);

    eval_res.map_err(|e| format!("JS Error: {}", e))?;


    // Copy modified variables back out
    if let Ok(guard) = shared_vars.lock() {
        *variables = guard.clone();
    }

    // Copy logs back out
    if let Ok(guard) = shared_logs.lock() {
        logs.extend(guard.clone());
    }

    Ok(())
}
