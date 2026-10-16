package main

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) *appHandler {
	t.Helper()
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html>sampler"), 0600)
	os.WriteFile(filepath.Join(dir, "engine.wasm"), []byte{0, 97, 115, 109, 1, 0, 0, 0}, 0600)
	os.WriteFile(filepath.Join(dir, "sw.js"), []byte("self.test=true"), 0600)
	os.Mkdir(filepath.Join(dir, "sub"), 0700)
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	return &appHandler{root: root, host: "127.0.0.1:17870", token: strings.Repeat("a", 64), stop: func() {}}
}
func request(a *appHandler, method, target, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://"+a.host+target, strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("Origin", a.origin())
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := httptest.NewRecorder()
	a.ServeHTTP(response, req)
	return response
}
func TestStaticAppAndWasm(t *testing.T) {
	a := fixture(t)
	for _, item := range []struct{ path, mime string }{{"/", "text/html; charset=utf-8"}, {"/engine.wasm", "application/wasm"}, {"/sw.js", "text/javascript; charset=utf-8"}} {
		r := request(a, "GET", item.path, "")
		if r.Code != 200 || r.Header().Get("Content-Type") != item.mime {
			t.Fatalf("%s: %d %s", item.path, r.Code, r.Header().Get("Content-Type"))
		}
		if r.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal("missing nosniff")
		}
	}
	if request(a, "GET", "/sw.js", "").Header().Get("Service-Worker-Allowed") != "/" {
		t.Fatal("missing service worker scope")
	}
	if request(a, "HEAD", "/", "").Body.Len() != 0 {
		t.Fatal("HEAD body")
	}
	if request(a, "GET", "/sub/", "").Code != 404 {
		t.Fatal("directory listing exposed")
	}
	if request(a, "POST", "/index.html", "").Code != 405 {
		t.Fatal("static write allowed")
	}
}
func TestPathsAndSymlinkEscape(t *testing.T) {
	a := fixture(t)
	for _, p := range []string{"/../secret", "/%2e%2e/secret", "/src/.secret", "/..%5csecret", "/abc%00secret"} {
		if request(a, "GET", p, "").Code == 200 {
			t.Fatalf("unsafe path %q served", p)
		}
	}
	external := filepath.Join(t.TempDir(), "secret.txt")
	os.WriteFile(external, []byte("private"), 0600)
	if err := os.Symlink(external, filepath.Join(a.root.Name(), "escape.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if request(a, "GET", "/escape.txt", "").Code != 404 {
		t.Fatal("symlink escaped app root")
	}
}
func TestHostOriginAndRemote(t *testing.T) {
	a := fixture(t)
	for _, mutate := range []func(*http.Request){func(r *http.Request) { r.Host = "attacker.example" }, func(r *http.Request) { r.Header.Set("Origin", "https://attacker.example") }, func(r *http.Request) { r.RemoteAddr = "192.0.2.1:1234" }, func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") }} {
		r := httptest.NewRequest("GET", "http://"+a.host+"/", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		mutate(r)
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatalf("untrusted request returned %d", w.Code)
		}
	}
}
func TestProtectedStop(t *testing.T) {
	a := fixture(t)
	stopped := make(chan bool, 1)
	a.stop = func() { stopped <- true }
	if request(a, "GET", "/__launcher/stop?token="+a.token, "").Code != 405 {
		t.Fatal("GET stopped server")
	}
	if request(a, "POST", "/__launcher/stop", "token=wrong").Code != 403 {
		t.Fatal("invalid token accepted")
	}
	r := httptest.NewRequest("POST", "http://"+a.host+"/__launcher/stop", strings.NewReader("token="+a.token))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("missing Origin accepted")
	}
	if request(a, "GET", "/__launcher?token="+a.token, "").Code != 200 {
		t.Fatal("control page unavailable")
	}
	if request(a, "GET", "/__launcher", "").Code != 403 {
		t.Fatal("control page exposed token")
	}
	if request(a, "POST", "/__launcher/stop", url.Values{"token": {a.token}}.Encode()).Code != 200 {
		t.Fatal("authorized stop failed")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stop callback missing")
	}
}
func TestLoopbackAndPortCollision(t *testing.T) {
	first, err := listen(0)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	address := first.Addr().(*net.TCPAddr)
	if address.IP.String() != "127.0.0.1" {
		t.Fatal("bound externally")
	}
	second, err := listen(address.Port)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if second.Addr().String() == first.Addr().String() {
		t.Fatal("port collision not handled")
	}
	if _, err = listen(-1); err == nil {
		t.Fatal("invalid port accepted")
	}
}
func TestRealHTTP(t *testing.T) {
	a := fixture(t)
	listener, err := listen(0)
	if err != nil {
		t.Fatal(err)
	}
	a.host = listener.Addr().String()
	server := &http.Server{Handler: a}
	go server.Serve(listener)
	defer server.Close()
	response, err := http.Get(a.origin() + "/engine.wasm")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	bytes, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || len(bytes) != 8 {
		t.Fatal("HTTP integration failed")
	}
}
func TestDefaultBrowserCommand(t *testing.T) {
	for _, platform := range []string{"darwin", "windows"} {
		name, args, err := browserCommand(platform, "http://127.0.0.1:17870/")
		if err != nil || name == "" || len(args) == 0 {
			t.Fatal("missing default browser command")
		}
	}
	if _, _, err := browserCommand("darwin", "https://attacker.example"); err == nil {
		t.Fatal("nonlocal browser URL accepted")
	}
}

func TestExistingLauncherIdentity(t *testing.T) {
	a := fixture(t)
	a.fingerprint = "same-app-folder"
	listener, err := listen(0)
	if err != nil {
		t.Fatal(err)
	}
	a.host = listener.Addr().String()
	server := &http.Server{Handler: a}
	go server.Serve(listener)
	defer server.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	if !existingLauncher(port, "same-app-folder") {
		t.Fatal("existing instance not recognized")
	}
	if existingLauncher(port, "different-app-folder") {
		t.Fatal("unrelated app instance reused")
	}
	if existingLauncher(-1, "same-app-folder") {
		t.Fatal("invalid port probed")
	}
}
