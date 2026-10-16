// nicoSampler's dependency-free, loopback-only portable app launcher.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type appHandler struct {
	root                     *os.Root
	host, token, fingerprint string
	stop                     func()
	once                     sync.Once
}

func (a *appHandler) origin() string { return "http://" + a.host }
func (a *appHandler) authorized(token string) bool {
	return subtle.ConstantTimeCompare([]byte(token), []byte(a.token)) == 1
}
func (a *appHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-cache")
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || net.ParseIP(remote) == nil || !net.ParseIP(remote).IsLoopback() || r.Host != a.host {
		http.Error(w, "Local launcher requests only", http.StatusForbidden)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != a.origin() {
		http.Error(w, "Origin denied", http.StatusForbidden)
		return
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		http.Error(w, "Cross-site request denied", http.StatusForbidden)
		return
	}
	if r.URL.Path == "/__launcher/stop" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			http.Error(w, "POST required", http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("Origin") != a.origin() {
			http.Error(w, "Origin required", http.StatusForbidden)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1024)
		if err := r.ParseForm(); err != nil || !a.authorized(r.PostForm.Get("token")) {
			http.Error(w, "Invalid stop token", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, "<!doctype html><meta charset=utf-8><title>nicoSampler stopped</title><p>Local server stopped. Save your work and close the sampler tab if it is still open.</p>")
		a.once.Do(func() { go func() { time.Sleep(50 * time.Millisecond); a.stop() }() })
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Read-only app server", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/__launcher/status" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if r.Method != http.MethodHead {
			json.NewEncoder(w).Encode(map[string]any{"app": "nicoSampler-portable", "protocol": 1, "fingerprint": a.fingerprint})
		}
		return
	}
	if r.URL.Path == "/__launcher" {
		if !a.authorized(r.URL.Query().Get("token")) {
			http.Error(w, "Invalid launcher token", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.Method != http.MethodHead {
			fmt.Fprintf(w, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>nicoSampler launcher</title><style>body{font:16px Helvetica,Arial,sans-serif;max-width:36em;margin:12vh auto;padding:20px;background:#18211b;color:#e3eadb}button,a{font:inherit;color:inherit}button{padding:12px;background:#34482e;border:1px solid #a9c98d;cursor:pointer}</style><h1>nicoSampler local server</h1><p><a href="/" target="_blank" rel="noopener">Open sampler</a></p><p>Save your work before stopping. This stops the local server; an already cached sampler tab may continue running until you close it.</p><form method="post" action="/__launcher/stop"><input type="hidden" name="token" value="%s"><button>Stop local server</button></form></html>`, a.token)
		}
		return
	}
	p := r.URL.Path
	if strings.ContainsAny(p, "\\\x00") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	for _, segment := range strings.Split(p, "/") {
		if segment == ".." || strings.HasPrefix(segment, ".") {
			http.Error(w, "Invalid path", http.StatusBadRequest)
			return
		}
	}
	clean := path.Clean("/" + p)
	if clean == "/" {
		clean = "/index.html"
	}
	name := strings.TrimPrefix(clean, "/")
	file, err := a.root.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	contentType := map[string]string{".wasm": "application/wasm", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8"}[strings.ToLower(filepath.Ext(name))]
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(name))
	}
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if name == "sw.js" {
		w.Header().Set("Service-Worker-Allowed", "/")
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
func listen(port int) (net.Listener, error) {
	if port < 0 || port > 65535 {
		return nil, errors.New("port must be 0 through 65535")
	}
	var last error
	for attempt := 0; attempt < 20 && port+attempt <= 65535; attempt++ {
		candidate := port + attempt
		if port == 0 {
			candidate = 0
		}
		listener, err := net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(candidate)))
		if err == nil {
			return listener, nil
		}
		last = err
		if port == 0 {
			break
		}
	}
	return nil, last
}
func appFingerprint(root string) string {
	canonical, err := filepath.Abs(root)
	if err != nil {
		canonical = root
	}
	if resolved, err := filepath.EvalSymlinks(canonical); err == nil {
		canonical = resolved
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}
func existingLauncher(port int, fingerprint string) bool {
	if port <= 0 || port > 65535 {
		return false
	}
	client := &http.Client{Timeout: 300 * time.Millisecond, Transport: &http.Transport{Proxy: nil, DisableKeepAlives: true}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/__launcher/status")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	var status struct {
		App         string `json:"app"`
		Protocol    int    `json:"protocol"`
		Fingerprint string `json:"fingerprint"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1024)).Decode(&status) != nil {
		return false
	}
	return status.App == "nicoSampler-portable" && status.Protocol == 1 && status.Fingerprint == fingerprint
}
func openBrowser(address string) {
	command, args, err := browserCommand(runtime.GOOS, address)
	if err == nil {
		process := exec.Command(command, args...)
		err = process.Start()
		if err == nil {
			go process.Wait()
		}
	}
	if err != nil {
		fmt.Println("Could not open the default browser; open the URL above manually.")
	}
}
func browserCommand(platform, address string) (string, []string, error) {
	if parsed, err := url.Parse(address); err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" {
		return "", nil, errors.New("invalid local browser URL")
	}
	switch platform {
	case "darwin":
		return "open", []string{address}, nil
	case "windows":
		return "rundll32", []string{"url.dll,FileProtocolHandler", address}, nil
	case "linux":
		return "xdg-open", []string{address}, nil
	default:
		return "", nil, errors.New("open the printed URL in your browser")
	}
}
func defaultApp() string {
	executable, err := os.Executable()
	if err != nil {
		return "app"
	}
	dir := filepath.Dir(executable)
	for _, candidate := range []string{filepath.Join(dir, "app"), filepath.Join(dir, "..", "..", "app")} {
		if info, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}
	return filepath.Join(dir, "..", "..", "app")
}
func run() error {
	app := flag.String("app", defaultApp(), "directory containing index.html")
	port := flag.Int("port", 17870, "preferred loopback port (0 selects a free port)")
	noOpen := flag.Bool("no-open", false, "print the browser URL without opening it")
	flag.Parse()
	root, err := os.OpenRoot(*app)
	if err != nil {
		return fmt.Errorf("app folder unavailable: %w", err)
	}
	defer root.Close()
	index, err := root.Open("index.html")
	if err != nil {
		return errors.New("app/index.html is missing; extract the complete portable folder first")
	}
	index.Close()
	fingerprint := appFingerprint(*app)
	if *port > 0 {
		for candidate := *port; candidate < *port+20 && candidate <= 65535; candidate++ {
			if existingLauncher(candidate, fingerprint) {
				address := "http://127.0.0.1:" + strconv.Itoa(candidate) + "/"
				fmt.Println("Reusing the existing nicoSampler local server; browser recovery stays on the same origin.")
				fmt.Println("URL:", address)
				fmt.Println("Use the original launcher window or its controls page to stop that server.")
				if !*noOpen {
					openBrowser(address)
				}
				return nil
			}
		}
	}
	listener, err := listen(*port)
	if err != nil {
		return fmt.Errorf("cannot start local server: %w", err)
	}
	defer listener.Close()
	tokenBytes := make([]byte, 32)
	if _, err = rand.Read(tokenBytes); err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	handler := &appHandler{root: root, host: listener.Addr().String(), token: hex.EncodeToString(tokenBytes), fingerprint: fingerprint, stop: cancel}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	address := "http://" + listener.Addr().String() + "/"
	fmt.Println("nicoSampler portable launcher")
	fmt.Println("URL:", address)
	fmt.Println("Launcher controls:", address+"__launcher?token="+handler.token)
	fmt.Println("Keep this window open. Save before quitting. Press Ctrl+C to stop the local server.")
	if *port != 0 && listener.Addr().(*net.TCPAddr).Port != *port {
		fmt.Println("Preferred port is busy; a different local port is in use. Browser recovery storage is separate for each port.")
	}
	if !*noOpen {
		openBrowser(address)
	}
	finished := make(chan error, 1)
	go func() { finished <- server.Serve(listener) }()
	select {
	case err = <-finished:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdownCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if err = server.Shutdown(shutdownCtx); err != nil {
			return err
		}
	}
	fmt.Println("Local server stopped.")
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "nicoSampler:", err)
		os.Exit(1)
	}
}
