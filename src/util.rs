use std::{convert::Infallible, time::{SystemTime, UNIX_EPOCH}};

use serde::Serialize;

#[macro_export]
macro_rules! err_is_400 {
    ($x:expr) => {
        match $x {
            Ok(x) => x,
            Err(e) => {
                return Ok(Box::new(warp::reply::with_status(
                    format!("Error: {e}"),
                    warp::http::StatusCode::BAD_REQUEST,
                )));
            }
        }
    };
}

pub fn now_sec() -> u64 {
    let start = SystemTime::now();
    let since_the_epoch = start.duration_since(UNIX_EPOCH)
        .expect("Time went backwards");
    since_the_epoch.as_secs()
}

pub fn reply_with<T: Serialize>(data: &T) -> Result<Box<dyn warp::Reply>, Infallible> {
    let data = serde_json::to_string_pretty(data).unwrap();
    Ok(Box::new(
        warp::http::response::Builder::new()
            .header("Content-Type", "application/json")
            .body(data),
    ))
}

pub fn vstr_from_error(value: eyre::ErrReport) -> Vec<String> {
    let mut msgs = Vec::new();
    for e in value.chain() {
        msgs.push(e.to_string());
    }
    msgs
}