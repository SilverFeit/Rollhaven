package embed

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed all:frontend_dist
var embeddedFiles embed.FS

// GetFileSystem returns an http.FileSystem rooted at the compiled React build.
func GetFileSystem() http.FileSystem {
	fsys, err := fs.Sub(embeddedFiles, "frontend_dist")
	if err != nil {
		panic(err)
	}
	return http.FS(fsys)
}
