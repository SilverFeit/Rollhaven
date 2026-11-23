//go:build ignore

package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintf(os.Stderr, "usage: go run gen_icons.go <input-image> <repo-root>\n")
		os.Exit(1)
	}
	inPath := os.Args[1]
	root := os.Args[2]

	f, err := os.Open(inPath)
	if err != nil {
		panic(err)
	}
	defer f.Close()

	src, _, err := image.Decode(f)
	if err != nil {
		panic(err)
	}

	sq := padToSquare(src)

	// Generate rounded icon master at 1024x1024
	master := makeRoundedIcon(sq, 1024)

	// Save PNG assets
	savePNG(filepath.Join(root, "docs/assets/app-icon.png"), resizeBilinear(master, 512, 512))
	savePNG(filepath.Join(root, "frontend/public/app-icon.png"), resizeBilinear(master, 256, 256))
	savePNG(filepath.Join(root, "frontend/public/favicon.png"), resizeBilinear(master, 64, 64))

	// Save iconset PNGs for macOS iconutil
	iconsetDir := filepath.Join(root, "Scripts/AppIcon.iconset")
	if err := os.MkdirAll(iconsetDir, 0o755); err != nil {
		panic(err)
	}
	iconsetSizes := []struct {
		name string
		size int
	}{
		{"icon_16x16.png", 16},
		{"icon_16x16@2x.png", 32},
		{"icon_32x32.png", 32},
		{"icon_32x32@2x.png", 64},
		{"icon_128x128.png", 128},
		{"icon_128x128@2x.png", 256},
		{"icon_256x256.png", 256},
		{"icon_256x256@2x.png", 512},
		{"icon_512x512.png", 512},
		{"icon_512x512@2x.png", 1024},
	}
	for _, s := range iconsetSizes {
		img := resizeBilinear(master, s.size, s.size)
		savePNG(filepath.Join(iconsetDir, s.name), img)
	}

	// Build Windows .ico and .syso (RT_ICON + RT_GROUP_ICON)
	icoSizes := []int{16, 32, 48, 64, 128, 256}
	var pngPayloads [][]byte
	for _, sz := range icoSizes {
		img := resizeBilinear(master, sz, sz)
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			panic(err)
		}
		pngPayloads = append(pngPayloads, buf.Bytes())
	}

	icoBytes := buildICO(icoSizes, pngPayloads)
	if err := os.WriteFile(filepath.Join(root, "Scripts/app.ico"), icoBytes, 0o644); err != nil {
		panic(err)
	}

	sysoBytes := buildWindowsSysoAMD64(icoSizes, pngPayloads)
	if err := os.WriteFile(filepath.Join(root, "cmd/app/rsrc_windows_amd64.syso"), sysoBytes, 0o644); err != nil {
		panic(err)
	}

	fmt.Println("Generated app-icon.png, favicon.png, iconset, app.ico, and rsrc_windows_amd64.syso")
}

func padToSquare(src image.Image) *image.RGBA {
	b := src.Bounds()
	w := b.Dx()
	h := b.Dy()
	side := w
	if h > side {
		side = h
	}
	dst := image.NewRGBA(image.Rect(0, 0, side, side))

	// Sample average dark edge color
	var rSum, gSum, bSum, count uint64
	for x := b.Min.X; x < b.Max.X; x++ {
		for _, y := range []int{b.Min.Y, b.Max.Y - 1} {
			r, g, bl, _ := src.At(x, y).RGBA()
			rSum += uint64(r >> 8)
			gSum += uint64(g >> 8)
			bSum += uint64(bl >> 8)
			count++
		}
	}
	bg := color.RGBA{
		R: uint8(rSum / count),
		G: uint8(gSum / count),
		B: uint8(bSum / count),
		A: 255,
	}
	draw.Draw(dst, dst.Bounds(), &image.Uniform{bg}, image.Point{}, draw.Src)

	ox := (side - w) / 2
	oy := (side - h) / 2
	// Mirror top and bottom edges seamlessly so hexagonal background lines don't streak
	for y := 0; y < oy; y++ {
		sy := oy - y
		if sy >= h {
			sy = h - 1
		}
		for x := 0; x < w; x++ {
			dst.Set(ox+x, y, src.At(b.Min.X+x, b.Min.Y+sy))
		}
	}
	for y := oy + h; y < side; y++ {
		sy := h - 1 - (y - (oy + h))
		if sy < 0 {
			sy = 0
		}
		for x := 0; x < w; x++ {
			dst.Set(ox+x, y, src.At(b.Min.X+x, b.Min.Y+sy))
		}
	}
	draw.Draw(dst, image.Rect(ox, oy, ox+w, oy+h), src, b.Min, draw.Src)
	return dst
}

func makeRoundedIcon(src *image.RGBA, size int) *image.RGBA {
	scaled := resizeBilinear(src, size, size)
	out := image.NewRGBA(image.Rect(0, 0, size, size))
	r := float64(size) * 0.21
	half := float64(size) / 2.0
	box := half - r

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			px := float64(x) + 0.5 - half
			py := float64(y) + 0.5 - half
			dx := math.Max(math.Abs(px)-box, 0)
			dy := math.Max(math.Abs(py)-box, 0)
			dist := math.Hypot(dx, dy) - r

			// Smooth anti-aliased alpha edge
			alpha := 1.0
			if dist > 0.5 {
				alpha = 0
			} else if dist > -0.5 {
				alpha = 0.5 - dist
			}
			if alpha <= 0 {
				continue
			}

			c := scaled.RGBAAt(x, y)
			// Subtle arcane violet-gold inner border glow near the rounded perimeter
			if dist > -float64(size)*0.022 && dist <= 0.5 {
				t := 1.0 - math.Abs(dist+float64(size)*0.01)/(float64(size)*0.014)
				if t > 0 {
					c.R = clampU8(float64(c.R) + t*45)
					c.G = clampU8(float64(c.G) + t*24)
					c.B = clampU8(float64(c.B) + t*95)
				}
			}
			c.A = uint8(math.Round(alpha * 255))
			out.SetRGBA(x, y, c)
		}
	}
	return out
}

func resizeBilinear(src image.Image, w, h int) *image.RGBA {
	sb := src.Bounds()
	sw := sb.Dx()
	sh := sb.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		sy := (float64(y)+0.5)*float64(sh)/float64(h) - 0.5
		y0 := int(math.Floor(sy))
		y1 := y0 + 1
		fy := sy - float64(y0)
		if y0 < 0 {
			y0 = 0
		}
		if y1 >= sh {
			y1 = sh - 1
		}
		for x := 0; x < w; x++ {
			sx := (float64(x)+0.5)*float64(sw)/float64(w) - 0.5
			x0 := int(math.Floor(sx))
			x1 := x0 + 1
			fx := sx - float64(x0)
			if x0 < 0 {
				x0 = 0
			}
			if x1 >= sw {
				x1 = sw - 1
			}

			c00 := color.RGBAModel.Convert(src.At(sb.Min.X+x0, sb.Min.Y+y0)).(color.RGBA)
			c10 := color.RGBAModel.Convert(src.At(sb.Min.X+x1, sb.Min.Y+y0)).(color.RGBA)
			c01 := color.RGBAModel.Convert(src.At(sb.Min.X+x0, sb.Min.Y+y1)).(color.RGBA)
			c11 := color.RGBAModel.Convert(src.At(sb.Min.X+x1, sb.Min.Y+y1)).(color.RGBA)

			lerp := func(a, b, c, d uint8) uint8 {
				top := float64(a)*(1-fx) + float64(b)*fx
				bot := float64(c)*(1-fx) + float64(d)*fx
				return clampU8(top*(1-fy) + bot*fy)
			}
			dst.SetRGBA(x, y, color.RGBA{
				R: lerp(c00.R, c10.R, c01.R, c11.R),
				G: lerp(c00.G, c10.G, c01.G, c11.G),
				B: lerp(c00.B, c10.B, c01.B, c11.B),
				A: lerp(c00.A, c10.A, c01.A, c11.A),
			})
		}
	}
	return dst
}

func clampU8(v float64) uint8 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return uint8(math.Round(v))
}

func savePNG(path string, img image.Image) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		panic(err)
	}
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
}

func buildICO(sizes []int, payloads [][]byte) []byte {
	var buf bytes.Buffer
	// ICONDIR: Reserved(2)=0, Type(2)=1, Count(2)
	binary.Write(&buf, binary.LittleEndian, uint16(0))
	binary.Write(&buf, binary.LittleEndian, uint16(1))
	binary.Write(&buf, binary.LittleEndian, uint16(len(sizes)))

	offset := uint32(6 + 16*len(sizes))
	for i, sz := range sizes {
		w := uint8(sz)
		h := uint8(sz)
		if sz >= 256 {
			w = 0
			h = 0
		}
		buf.WriteByte(w)                                               // bWidth
		buf.WriteByte(h)                                               // bHeight
		buf.WriteByte(0)                                               // bColorCount
		buf.WriteByte(0)                                               // bReserved
		binary.Write(&buf, binary.LittleEndian, uint16(1))             // wPlanes
		binary.Write(&buf, binary.LittleEndian, uint16(32))            // wBitCount
		binary.Write(&buf, binary.LittleEndian, uint32(len(payloads[i])))
		binary.Write(&buf, binary.LittleEndian, offset)
		offset += uint32(len(payloads[i]))
	}
	for _, p := range payloads {
		buf.Write(p)
	}
	return buf.Bytes()
}

// buildWindowsSysoAMD64 generates a valid PE/COFF .rsrc object file for Windows x64
// containing RT_ICON (3) and RT_GROUP_ICON (14) so GOOS=windows GOARCH=amd64 embeds the icon.
func buildWindowsSysoAMD64(sizes []int, payloads [][]byte) []byte {
	// Build GRPICONDIR payload
	var grp bytes.Buffer
	binary.Write(&grp, binary.LittleEndian, uint16(0))
	binary.Write(&grp, binary.LittleEndian, uint16(1))
	binary.Write(&grp, binary.LittleEndian, uint16(len(sizes)))
	for i, sz := range sizes {
		w := uint8(sz)
		h := uint8(sz)
		if sz >= 256 {
			w = 0
			h = 0
		}
		grp.WriteByte(w)
		grp.WriteByte(h)
		grp.WriteByte(0)
		grp.WriteByte(0)
		binary.Write(&grp, binary.LittleEndian, uint16(1))
		binary.Write(&grp, binary.LittleEndian, uint16(32))
		binary.Write(&grp, binary.LittleEndian, uint32(len(payloads[i])))
		binary.Write(&grp, binary.LittleEndian, uint16(i+1)) // nID = 1..N
	}
	grpBytes := grp.Bytes()

	// Layout of .rsrc section:
	// - Root directory: 16 + 2*8 = 32 bytes (Type 3 = RT_ICON, Type 14 = RT_GROUP_ICON)
	// - Type 3 dir (icons): 16 + N*8 bytes
	// - Type 14 dir (group): 16 + 1*8 = 24 bytes
	// - Language dirs: (N + 1) * (16 + 1*8) = (N + 1) * 24 bytes (Lang ID 0x0409)
	// - Data entries: (N + 1) * 16 bytes (each has OffsetToData relocated by IMAGE_REL_AMD64_ADDR32NB)
	// - Raw data blobs aligned to 4 bytes

	nIcons := len(payloads)
	nResources := nIcons + 1

	var rsrc bytes.Buffer
	writeDir := func(numNamed, numID uint16) {
		binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // Characteristics
		binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // TimeDateStamp
		binary.Write(&rsrc, binary.LittleEndian, uint16(0)) // MajorVersion
		binary.Write(&rsrc, binary.LittleEndian, uint16(0)) // MinorVersion
		binary.Write(&rsrc, binary.LittleEndian, numNamed)
		binary.Write(&rsrc, binary.LittleEndian, numID)
	}
	writeEntry := func(idOrName uint32, offset uint32, isSubdir bool) {
		binary.Write(&rsrc, binary.LittleEndian, idOrName)
		if isSubdir {
			offset |= 0x80000000
		}
		binary.Write(&rsrc, binary.LittleEndian, offset)
	}

	rootOff := uint32(0)
	type3Off := rootOff + 32
	type14Off := type3Off + uint32(16+nIcons*8)
	langStartOff := type14Off + 24
	dataEntryStartOff := langStartOff + uint32(nResources*24)
	rawDataStartOff := dataEntryStartOff + uint32(nResources*16)

	// 1. Root directory (2 ID entries: 3 and 14)
	writeDir(0, 2)
	writeEntry(3, type3Off, true)
	writeEntry(14, type14Off, true)

	// 2. Type 3 directory (IDs 1..N)
	writeDir(0, uint16(nIcons))
	for i := 0; i < nIcons; i++ {
		writeEntry(uint32(i+1), langStartOff+uint32(i*24), true)
	}

	// 3. Type 14 directory (ID 1)
	writeDir(0, 1)
	writeEntry(1, langStartOff+uint32(nIcons*24), true)

	// 4. Language directories (0x0409)
	for i := 0; i < nResources; i++ {
		writeDir(0, 1)
		writeEntry(0x0409, dataEntryStartOff+uint32(i*16), false)
	}

	// 5. Data entries + collect relocation offsets
	type reloc struct {
		virtualAddress uint32
		symbolIndex    uint32
		typ            uint16
	}
	var relocs []reloc

	blobs := append([][]byte{}, payloads...)
	blobs = append(blobs, grpBytes)

	curBlobOff := rawDataStartOff
	for _, b := range blobs {
		relocOff := uint32(rsrc.Len())
		relocs = append(relocs, reloc{
			virtualAddress: relocOff,
			symbolIndex:    0,      // symbol 0 is ".rsrc"
			typ:            0x0003, // IMAGE_REL_AMD64_ADDR32NB
		})
		binary.Write(&rsrc, binary.LittleEndian, curBlobOff)
		binary.Write(&rsrc, binary.LittleEndian, uint32(len(b)))
		binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // CodePage
		binary.Write(&rsrc, binary.LittleEndian, uint32(0)) // Reserved
		padded := (uint32(len(b)) + 3) &^ 3
		curBlobOff += padded
	}

	// 6. Write raw blobs padded to 4 bytes
	for _, b := range blobs {
		rsrc.Write(b)
		for rsrc.Len()%4 != 0 {
			rsrc.WriteByte(0)
		}
	}

	rsrcBytes := rsrc.Bytes()

	// Assemble COFF object file:
	// - COFF File Header: 20 bytes
	// - Section Header (".rsrc"): 40 bytes
	// - Section Data: len(rsrcBytes)
	// - Relocations: len(relocs) * 10 bytes
	// - Symbol Table: 1 symbol (".rsrc") * 18 bytes
	// - String Table: 4 bytes (size = 4, empty)
	var coff bytes.Buffer
	secDataOff := uint32(20 + 40)
	relocOff := secDataOff + uint32(len(rsrcBytes))
	symTableOff := relocOff + uint32(len(relocs)*10)

	// COFF Header
	binary.Write(&coff, binary.LittleEndian, uint16(0x8664))     // Machine: AMD64
	binary.Write(&coff, binary.LittleEndian, uint16(1))          // NumberOfSections
	binary.Write(&coff, binary.LittleEndian, uint32(0))          // TimeDateStamp
	binary.Write(&coff, binary.LittleEndian, symTableOff)        // PointerToSymbolTable
	binary.Write(&coff, binary.LittleEndian, uint32(1))          // NumberOfSymbols
	binary.Write(&coff, binary.LittleEndian, uint16(0))          // SizeOfOptionalHeader
	binary.Write(&coff, binary.LittleEndian, uint16(0x0104))     // Characteristics: LINE_NUMS_STRIPPED | 32BIT/LARGE

	// Section Header ".rsrc"
	var secName [8]byte
	copy(secName[:], ".rsrc")
	coff.Write(secName[:])
	binary.Write(&coff, binary.LittleEndian, uint32(0))               // VirtualSize
	binary.Write(&coff, binary.LittleEndian, uint32(0))               // VirtualAddress
	binary.Write(&coff, binary.LittleEndian, uint32(len(rsrcBytes)))  // SizeOfRawData
	binary.Write(&coff, binary.LittleEndian, secDataOff)              // PointerToRawData
	binary.Write(&coff, binary.LittleEndian, relocOff)                // PointerToRelocations
	binary.Write(&coff, binary.LittleEndian, uint32(0))               // PointerToLinenumbers
	binary.Write(&coff, binary.LittleEndian, uint16(len(relocs)))     // NumberOfRelocations
	binary.Write(&coff, binary.LittleEndian, uint16(0))               // NumberOfLinenumbers
	binary.Write(&coff, binary.LittleEndian, uint32(0x40000040))      // Characteristics: CNT_INITIALIZED_DATA | MEM_READ

	// Section Raw Data
	coff.Write(rsrcBytes)

	// Relocations
	for _, r := range relocs {
		binary.Write(&coff, binary.LittleEndian, r.virtualAddress)
		binary.Write(&coff, binary.LittleEndian, r.symbolIndex)
		binary.Write(&coff, binary.LittleEndian, r.typ)
	}

	// Symbol Table: 1 entry for ".rsrc"
	coff.Write(secName[:])
	binary.Write(&coff, binary.LittleEndian, uint32(0))  // Value
	binary.Write(&coff, binary.LittleEndian, int16(1))   // SectionNumber (1-based)
	binary.Write(&coff, binary.LittleEndian, uint16(0))  // Type
	coff.WriteByte(3)                                    // StorageClass: IMAGE_SYM_CLASS_STATIC
	coff.WriteByte(0)                                    // NumberOfAuxSymbols

	// String Table (length = 4)
	binary.Write(&coff, binary.LittleEndian, uint32(4))

	return coff.Bytes()
}
