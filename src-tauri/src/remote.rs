// The desktop app used as a window on the centre's server. The server has its
// own (self-signed) certificate, which a normal web view refuses; so the app
// talks to it from here: HTTPS, and the certificate's fingerprint is remembered
// the first time ("pinned") — afterwards a different certificate is refused.

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;

#[derive(Debug)]
struct PinVerifier {
    pin: Option<String>,
    seen: Mutex<Option<String>>,
    provider: Arc<CryptoProvider>,
}

fn fingerprint(der: &[u8]) -> String {
    let d = ring::digest::digest(&ring::digest::SHA256, der);
    d.as_ref().iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join(":")
}

impl ServerCertVerifier for PinVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let fp = fingerprint(end_entity.as_ref());
        *self.seen.lock().unwrap() = Some(fp.clone());
        match &self.pin {
            Some(p) if *p != fp => Err(rustls::Error::General("CERT_CHANGED".into())),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

struct Conn {
    base: String,
    agent: ureq::Agent,
    verifier: Arc<PinVerifier>,
    /// the server's cookies (the session), kept here like a browser would
    cookies: BTreeMap<String, String>,
}

#[derive(Default)]
pub struct RemoteState(Mutex<Option<Conn>>);

#[derive(Serialize)]
pub struct Reply {
    status: u16,
    body: String,
}

#[derive(Serialize)]
pub struct Connected {
    fingerprint: String,
    hello: Value,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    let s = e.to_string();
    if s.contains("CERT_CHANGED") {
        "CERT_CHANGED".into()
    } else {
        s
    }
}

fn agent_for(pin: Option<String>) -> Result<(ureq::Agent, Arc<PinVerifier>), String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = Arc::new(PinVerifier { pin, seen: Mutex::new(None), provider: provider.clone() });
    let tls = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(err)?
        .dangerous()
        .with_custom_certificate_verifier(verifier.clone())
        .with_no_client_auth();
    let agent = ureq::AgentBuilder::new()
        .tls_config(Arc::new(tls))
        .timeout_connect(Duration::from_secs(8))
        .timeout(Duration::from_secs(120))
        .redirects(0)
        .build();
    Ok((agent, verifier))
}

fn send(c: &mut Conn, method: &str, path: &str, body: Option<&str>, background: bool) -> Result<Reply, String> {
    let url = format!("{}{}", c.base, path);
    let mut req = c.agent.request(method, &url);
    if background {
        // an automatic check by the screen: does not keep the session open
        req = req.set("X-Magis-Background", "1");
    }
    if !c.cookies.is_empty() {
        let jar = c.cookies.iter().map(|(k, v)| format!("{}={}", k, v)).collect::<Vec<_>>().join("; ");
        req = req.set("Cookie", &jar);
    }
    let res = match body {
        Some(b) => req.set("Content-Type", "application/json").send_string(b),
        None => req.call(),
    };
    let resp = match res {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(err(e)),
    };
    for h in resp.all("set-cookie") {
        let first = h.split(';').next().unwrap_or("");
        if let Some((k, v)) = first.split_once('=') {
            let gone = v.is_empty() || h.to_ascii_lowercase().contains("max-age=0");
            if gone {
                c.cookies.remove(k.trim());
            } else {
                c.cookies.insert(k.trim().to_string(), v.trim().to_string());
            }
        }
    }
    let status = resp.status();
    let body = resp.into_string().map_err(err)?;
    Ok(Reply { status, body })
}

/// Connects to `base` (e.g. https://192.168.1.20:8443). `pin` is the fingerprint
/// remembered last time; None the very first time.
#[tauri::command(async)]
pub fn srv_connect(state: State<RemoteState>, base: String, pin: Option<String>) -> Result<Connected, String> {
    let (agent, verifier) = agent_for(pin)?;
    let mut c = Conn { base: base.trim_end_matches('/').to_string(), agent, verifier, cookies: BTreeMap::new() };
    let r = send(&mut c, "GET", "/api/hello", None, false)?;
    let hello: Value = serde_json::from_str(&r.body).map_err(|_| "NOT_MAGIS".to_string())?;
    if hello.get("server") != Some(&Value::Bool(true)) {
        return Err("NOT_MAGIS".into());
    }
    let fingerprint = c.verifier.seen.lock().unwrap().clone().unwrap_or_default();
    *state.0.lock().unwrap() = Some(c);
    Ok(Connected { fingerprint, hello })
}

#[tauri::command(async)]
pub fn srv_request(state: State<RemoteState>, method: String, path: String, body: Option<String>, background: Option<bool>) -> Result<Reply, String> {
    let mut g = state.0.lock().unwrap();
    let c = g.as_mut().ok_or("NOT_CONNECTED")?;
    send(c, &method, &path, body.as_deref(), background.unwrap_or(false))
}

#[tauri::command]
pub fn srv_disconnect(state: State<RemoteState>) {
    *state.0.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    // Runs only with MAGIS_TEST_SERVER=https://localhost:PORT (a test server).
    #[test]
    fn talks_to_a_test_server() {
        let Ok(base) = std::env::var("MAGIS_TEST_SERVER") else { return };
        let (agent, verifier) = agent_for(None).unwrap();
        let mut c = Conn { base: base.clone(), agent, verifier, cookies: BTreeMap::new() };
        let r = send(&mut c, "GET", "/api/hello", None, false).unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        assert!(r.body.contains("\"server\":true"));
        let fp = c.verifier.seen.lock().unwrap().clone().unwrap();
        assert_eq!(fp.len(), 95);
        // a POST with a JSON body reaches the server (refused: not signed in)
        let r = send(&mut c, "POST", "/api/op/data", Some("{}"), false).unwrap();
        assert_eq!(r.status, 401);
        // same certificate pinned: accepted; another pin: refused
        let (agent, verifier) = agent_for(Some(fp.clone())).unwrap();
        let mut ok = Conn { base: base.clone(), agent, verifier, cookies: BTreeMap::new() };
        assert_eq!(send(&mut ok, "GET", "/api/hello", None, false).unwrap().status, 200);
        let (agent, verifier) = agent_for(Some("00".into())).unwrap();
        let mut bad = Conn { base, agent, verifier, cookies: BTreeMap::new() };
        assert_eq!(send(&mut bad, "GET", "/api/hello", None, false).err().unwrap(), "CERT_CHANGED");
    }
}
