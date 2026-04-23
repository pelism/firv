use crate::runner::FirvResponse;
use rquickjs::{Context, Function, Object, Runtime};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub fn execute_script(
    script: &str,
    variables: &mut HashMap<String, String>,
    response: Option<&FirvResponse>,
    logs: &mut Vec<String>,
) -> Result<(), String> {
    let runtime = Runtime::new().map_err(|e| e.to_string())?;
    let context = Context::full(&runtime).map_err(|e| e.to_string())?;

    let shared_vars = Arc::new(Mutex::new(variables.clone()));
    let shared_logs = Arc::new(Mutex::new(Vec::new()));

    context
        .with(|ctx| {
            let global = ctx.globals();
            let firv_obj = Object::new(ctx.clone()).unwrap();

            // 2. Add log function
            let log_arc = Arc::clone(&shared_logs);
            firv_obj
                .set(
                    "log",
                    Function::new(ctx.clone(), move |msg: String| {
                        log_arc.lock().unwrap().push(msg.clone());
                        println!("JS Log: {}", msg);
                    })
                    .unwrap(),
                )
                .unwrap();

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

            // Expose response if it exists
            if let Some(resp) = response {
                let resp_obj = Object::new(ctx.clone()).unwrap();

                resp_obj.set("status", resp.status).unwrap();
                resp_obj.set("body", resp.body.clone()).unwrap();

                // json() method
                let body_str = resp.body.clone();
                let ctx_clone = ctx.clone();
                resp_obj
                    .set(
                        "json",
                        Function::new(ctx.clone(), move || -> rquickjs::Value {
                            ctx_clone
                                .eval::<rquickjs::Value, _>(format!("JSON.parse('{}')", body_str))
                                .unwrap()
                        })
                        .unwrap(),
                    )
                    .unwrap();

                firv_obj.set("response", resp_obj).unwrap();
            }

            global.set("firv", firv_obj).unwrap();

            ctx.eval::<(), _>(script)
        })
        .map_err(|e| format!("JS Error: {}", e))?;

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
