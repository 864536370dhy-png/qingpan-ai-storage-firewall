use super::keyring::keyring_entry;
use crate::models::{AiResponse, CleanupCandidate, ScanResult};
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

fn ai_summary(scan: &ScanResult) -> Value {
    json!({
        "disk": {
            "total_gb": scan.disk_total_bytes as f64 / 1_073_741_824.0,
            "available_gb": scan.disk_available_bytes as f64 / 1_073_741_824.0,
            "applications_gb": scan.recognized_apps_bytes as f64 / 1_073_741_824.0,
            "modified_24h_gb": scan.modified_24h_bytes as f64 / 1_073_741_824.0,
            "review_candidates_gb": scan.reclaimable_bytes as f64 / 1_073_741_824.0
        },
        "apps": scan.apps.iter().map(|app| json!({
            "name": app.name,
            "installed": app.installed,
            "is_system_app": app.is_system_app,
            "support_level": app.support_level,
            "application_gb": app.app_size_bytes as f64 / 1_073_741_824.0,
            "related_data_gb": app.related_data_size_bytes as f64 / 1_073_741_824.0,
            "modified_24h_gb": app.modified_24h_bytes as f64 / 1_073_741_824.0,
            "review_candidates_gb": app.reclaimable_bytes as f64 / 1_073_741_824.0,
            "categories": app.categories.iter().map(|category| json!({
                "label": category.label,
                "size_gb": category.size_bytes as f64 / 1_073_741_824.0,
                "risk_level": category.risk_level,
                "regenerable": category.regenerable,
                "protected": category.protected
            })).collect::<Vec<_>>()
        })).collect::<Vec<_>>(),
        "permission_errors": scan.permission_errors
    })
}

fn build_prompt(question: &str, scan: &ScanResult) -> String {
    format!(
        "你是轻盘AI空间分析助手。请只根据给出的匿名化磁盘汇总进行分析。\
        不要声称已经检查文件正文、删除、移动或验证任何文件；不要建议删除原始项目、聊天记录、照片、数据库或文档。\
        请用简体中文输出：1.一句话结论；2.占用最大的三个来源；3.建议优先检查的内容；\
        4.风险提示；5.下一步操作。明确区分应用本体、关联数据、24小时活跃文件体积和建议检查候选，\
        它们都不等于可以直接删除的空间。unknown与protected内容必须提示人工判断。\n\n用户问题：{}\n\n扫描汇总：{}",
        question,
        ai_summary(scan)
    )
}

#[tauri::command]
pub async fn analyze_scan(
    provider: String,
    model: String,
    question: String,
    scan: ScanResult,
) -> Result<AiResponse, String> {
    let api_key = keyring_entry(&provider)?
        .get_password()
        .map_err(|_| format!("尚未配置{} API Key", provider.to_uppercase()))?;
    let prompt = build_prompt(&question, &scan);
    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("创建AI请求失败：{error}"))?;
    let content = match provider.as_str() {
        "gemini" => call_gemini(&client, &api_key, &model, &prompt).await?,
        "deepseek" => {
            call_openai_compatible(
                &client,
                "https://api.deepseek.com/chat/completions",
                &api_key,
                &model,
                &prompt,
            )
            .await?
        }
        "openai" => call_openai(&client, &api_key, &model, &prompt).await?,
        _ => return Err("暂不支持该AI服务商".to_string()),
    };
    Ok(AiResponse {
        provider,
        model,
        content,
    })
}

#[tauri::command]
pub async fn analyze_cleanup_candidates(
    provider: String,
    model: String,
    question: String,
    candidates: Vec<CleanupCandidate>,
) -> Result<AiResponse, String> {
    if candidates.is_empty() {
        return Err("没有可供AI复核的项目".to_string());
    }
    let api_key = keyring_entry(&provider)?
        .get_password()
        .map_err(|_| format!("尚未配置{} API Key", provider.to_uppercase()))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let anonymous_items: Vec<Value> = candidates
        .iter()
        .take(30)
        .enumerate()
        .map(|(index, item)| {
            json!({
                "item": index + 1,
                "app": item.app_name,
                "category": item.category,
                "kind": item.file_kind,
                "item_type": item.item_type,
                "size_mb": item.size_bytes as f64 / 1_048_576.0,
                "days_since_modified": now.saturating_sub(item.modified_unix) / 86_400,
                "local_risk": item.risk,
                "selectable": item.selectable
            })
        })
        .collect();
    let prompt = format!(
        "你是轻盘的文件级处理复核助手。你只收到匿名化元数据，没有文件正文、文件名或完整路径。\
        请根据可重建性、修改时间、类型和本地风险，为每一项给出保留、可移入隔离区、或必须人工确认的建议。\
        protected与unknown项目不得建议处理。不得声称你已查看内容或执行操作。先给一句话结论，再按编号解释，最后给出最安全顺序。\n\n用户问题：{}\n\n匿名项目：{}",
        question,
        Value::Array(anonymous_items)
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("创建AI请求失败：{error}"))?;
    let content = match provider.as_str() {
        "gemini" => call_gemini(&client, &api_key, &model, &prompt).await?,
        "deepseek" => {
            call_openai_compatible(
                &client,
                "https://api.deepseek.com/chat/completions",
                &api_key,
                &model,
                &prompt,
            )
            .await?
        }
        "openai" => call_openai(&client, &api_key, &model, &prompt).await?,
        _ => return Err("暂不支持该AI服务商".to_string()),
    };
    Ok(AiResponse {
        provider,
        model,
        content,
    })
}

async fn call_gemini(
    client: &Client,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let response = client
        .post(format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        ))
        .header("x-goog-api-key", api_key)
        .json(&json!({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1400}
        }))
        .send()
        .await
        .map_err(|error| format!("Gemini请求失败：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Gemini返回解析失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Gemini返回错误 {status}：{}",
            provider_error(&body)
        ));
    }
    body.pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Gemini没有返回可显示的分析结果".to_string())
}

async fn call_openai_compatible(
    client: &Client,
    url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "messages": [
                {"role": "system", "content": "你是谨慎的本地存储分析助手。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.2,
            "max_tokens": 1400
        }))
        .send()
        .await
        .map_err(|error| format!("AI请求失败：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("AI返回解析失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("AI返回错误 {status}：{}", provider_error(&body)));
    }
    body.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "AI没有返回可显示的分析结果".to_string())
}

async fn call_openai(
    client: &Client,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let response = client
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&json!({
            "model": model,
            "input": prompt,
            "max_output_tokens": 1400,
            "store": false
        }))
        .send()
        .await
        .map_err(|error| format!("OpenAI请求失败：{error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("OpenAI返回解析失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OpenAI返回错误 {status}：{}",
            provider_error(&body)
        ));
    }
    if let Some(text) = body.get("output_text").and_then(Value::as_str) {
        return Ok(text.to_string());
    }
    body.pointer("/output/0/content/0/text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "OpenAI没有返回可显示的分析结果".to_string())
}

fn provider_error(body: &Value) -> String {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| body.get("message").and_then(Value::as_str))
        .unwrap_or("未知错误")
        .to_string()
}
