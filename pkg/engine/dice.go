package engine

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

var diceNotationRegex = regexp.MustCompile(`^\s*(\d*)[dD](\d+)\s*([+-]\s*\d+)?\s*$`)

const (
	MaxDiceExpressionLen = 256
	MaxDicePerExpression = 100
	MaxParenDepth        = 8
	MaxDieSides          = 10000
	MaxExplosions        = 50
	MaxRerollAttempts    = 10
)

// StandardDice lists all polyhedral dice required by D&D.
var StandardDice = []int{2, 4, 6, 8, 10, 12, 20, 100}

// DiceTerm provides structured per-term breakdown for Rollhaven's dice log and UI.
type DiceTerm struct {
	Kind     string `json:"kind"`               // "dice" | "constant"
	Notation string `json:"notation,omitempty"` // e.g. "2d20kh1", "4dF", "5d10cs>=7"
	Count    int    `json:"count,omitempty"`
	Sides    int    `json:"sides,omitempty"`
	Rolls    []int  `json:"rolls,omitempty"`
	Kept     []int  `json:"kept,omitempty"`
	Subtotal int    `json:"subtotal,omitempty"`
	Value    int    `json:"value"`
	Sign     int    `json:"sign"`
}

// DiceResult captures the outcome of a polyhedral or AST arithmetic/dicelib dice expression.
type DiceResult struct {
	Notation             string     `json:"notation"`
	NormalizedExpression string     `json:"normalized_expression"`
	Count                int        `json:"count"`
	Sides                int        `json:"sides"`
	Modifier             int        `json:"modifier"`
	Rolls                []int      `json:"rolls"`
	Subtotal             int        `json:"subtotal"`
	Total                int        `json:"total"`
	Terms                []DiceTerm `json:"terms,omitempty"`
	IsCritical           bool       `json:"is_critical"`
	IsFumble             bool       `json:"is_fumble"`
}

// ParseDiceNotation parses classic single-die expressions like "d20", "1d20+3", "2d6-1", "1d100".
func ParseDiceNotation(notation string) (count, sides, modifier int, normalized string, err error) {
	matches := diceNotationRegex.FindStringSubmatch(notation)
	if matches == nil {
		return 0, 0, 0, "", fmt.Errorf("notación de dado inválida: %q (usa NdX+M, ej. 1d20+3)", notation)
	}

	count = 1
	if matches[1] != "" {
		count, err = strconv.Atoi(matches[1])
		if err != nil || count < 1 || count > MaxDicePerExpression {
			return 0, 0, 0, "", fmt.Errorf("cantidad de dados debe estar entre 1 y %d", MaxDicePerExpression)
		}
	}

	sides, err = strconv.Atoi(matches[2])
	if err != nil || sides < 2 || sides > MaxDieSides {
		return 0, 0, 0, "", fmt.Errorf("número de caras inválido: %q", matches[2])
	}

	if matches[3] != "" {
		modStr := strings.ReplaceAll(matches[3], " ", "")
		modifier, err = strconv.Atoi(modStr)
		if err != nil || modifier < -10000 || modifier > 10000 {
			return 0, 0, 0, "", fmt.Errorf("modificador fuera de rango (-10000 a +10000)")
		}
	}

	if modifier > 0 {
		normalized = fmt.Sprintf("%dd%d+%d", count, sides, modifier)
	} else if modifier < 0 {
		normalized = fmt.Sprintf("%dd%d%d", count, sides, modifier)
	} else {
		normalized = fmt.Sprintf("%dd%d", count, sides)
	}

	return count, sides, modifier, normalized, nil
}

type tokKind int

const (
	tokEOF tokKind = iota
	tokNumber
	tokDice
	tokPlus
	tokMinus
	tokMul
	tokDiv
	tokLParen
	tokRParen
)

type diceToken struct {
	kind       tokKind
	numVal     int
	count      int
	sides      int
	isFudge    bool
	explode    bool
	rerollMax  int
	rerollOnce bool
	keepMode   string // "", "kh", "kl", "dh", "dl"
	keepCount  int
	successOp  string // "", ">=", ">"
	successVal int
}

func readDigits(runes []rune, i int) (val int, nextIdx int, ok bool) {
	n := len(runes)
	if i >= n || !unicode.IsDigit(runes[i]) {
		return 0, i, false
	}
	start := i
	for i < n && unicode.IsDigit(runes[i]) {
		i++
	}
	parsed, err := strconv.Atoi(string(runes[start:i]))
	if err != nil {
		return 0, i, false
	}
	return parsed, i, true
}

func tokenizeDiceExpr(input string) ([]diceToken, error) {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return nil, fmt.Errorf("la expresión de dados no puede estar vacía")
	}
	if len(trimmed) > MaxDiceExpressionLen {
		return nil, fmt.Errorf("la expresión supera el máximo de %d caracteres", MaxDiceExpressionLen)
	}

	var tokens []diceToken
	totalDice := 0
	runes := []rune(trimmed)
	n := len(runes)
	i := 0

	for i < n {
		r := runes[i]
		if unicode.IsSpace(r) {
			i++
			continue
		}

		switch r {
		case '+':
			tokens = append(tokens, diceToken{kind: tokPlus})
			i++
		case '-':
			tokens = append(tokens, diceToken{kind: tokMinus})
			i++
		case '*':
			tokens = append(tokens, diceToken{kind: tokMul})
			i++
		case '/':
			tokens = append(tokens, diceToken{kind: tokDiv})
			i++
		case '(':
			tokens = append(tokens, diceToken{kind: tokLParen})
			i++
		case ')':
			tokens = append(tokens, diceToken{kind: tokRParen})
			i++
		default:
			if unicode.IsDigit(r) || r == 'd' || r == 'D' {
				count := 1
				hasCount := false
				if unicode.IsDigit(r) {
					val, nextI, ok := readDigits(runes, i)
					if !ok {
						return nil, fmt.Errorf("número inválido cerca de %q", string(runes[i]))
					}
					i = nextI
					if i < n && (runes[i] == 'd' || runes[i] == 'D') {
						count = val
						hasCount = true
					} else {
						tokens = append(tokens, diceToken{kind: tokNumber, numVal: val})
						continue
					}
				}

				// Consume 'd' or 'D'
				if i >= n || (runes[i] != 'd' && runes[i] != 'D') {
					return nil, fmt.Errorf("se esperaba 'd' en expresión de dados")
				}
				i++

				if hasCount && count < 1 {
					return nil, fmt.Errorf("la cantidad de dados debe ser al menos 1")
				}

				sides := 0
				isFudge := false
				if i < n && (runes[i] == 'f' || runes[i] == 'F') {
					isFudge = true
					sides = 3
					i++
				} else {
					parsedSides, nextI, ok := readDigits(runes, i)
					if !ok || parsedSides < 2 || parsedSides > MaxDieSides {
						return nil, fmt.Errorf("número de caras inválido (%d..%d)", 2, MaxDieSides)
					}
					sides = parsedSides
					i = nextI
				}

				totalDice += count
				if totalDice > MaxDicePerExpression {
					return nil, fmt.Errorf("exceso de dados en la expresión (máximo %d)", MaxDicePerExpression)
				}

				tok := diceToken{
					kind:    tokDice,
					count:   count,
					sides:   sides,
					isFudge: isFudge,
				}

				// Parse chained dicelib modifiers: !, r[N], ro[N], kh[N], kl[N], dh[N], dl[N], cs>=N / cs>N
				for i < n {
					ch := unicode.ToLower(runes[i])
					if ch == '!' {
						if isFudge {
							return nil, fmt.Errorf("dados Fate/Fudge no soportan explosión (!)")
						}
						tok.explode = true
						i++
						continue
					}
					if ch == 'r' {
						if isFudge {
							return nil, fmt.Errorf("dados Fate/Fudge no soportan reroll")
						}
						i++
						once := false
						if i < n && unicode.ToLower(runes[i]) == 'o' {
							once = true
							i++
						}
						thresh, nextI, ok := readDigits(runes, i)
						if !ok {
							thresh = 1
						} else {
							i = nextI
						}
						if thresh < 1 || thresh >= sides {
							return nil, fmt.Errorf("umbral de reroll %d inválido para d%d", thresh, sides)
						}
						tok.rerollMax = thresh
						tok.rerollOnce = once
						continue
					}
					if (ch == 'k' || ch == 'd') && i+1 < n {
						next := unicode.ToLower(runes[i+1])
						if next == 'h' || next == 'l' {
							mode := string(ch) + string(next)
							i += 2
							kc, nextI, ok := readDigits(runes, i)
							if !ok {
								kc = 1
							} else {
								i = nextI
							}
							if kc < 1 {
								return nil, fmt.Errorf("modificador %s inválido", mode)
							}
							if ch == 'k' && kc > count {
								return nil, fmt.Errorf("no se pueden conservar %d dados de %d lanzados", kc, count)
							}
							if ch == 'd' && kc >= count {
								return nil, fmt.Errorf("no se pueden descartar %d dados de %d lanzados", kc, count)
							}
							tok.keepMode = mode
							tok.keepCount = kc
							continue
						}
					}
					if ch == 'c' && i+1 < n && unicode.ToLower(runes[i+1]) == 's' {
						i += 2
						op := ">="
						if i+1 < n && runes[i] == '>' && runes[i+1] == '=' {
							op = ">="
							i += 2
						} else if i < n && runes[i] == '>' {
							op = ">"
							i++
						}
						target, nextI, ok := readDigits(runes, i)
						if !ok {
							return nil, fmt.Errorf("falta umbral numérico después de cs")
						}
						i = nextI
						tok.successOp = op
						tok.successVal = target
						continue
					}
					break
				}

				tokens = append(tokens, tok)
				continue
			}

			return nil, fmt.Errorf("carácter no permitido en expresión de dados: %q", string(r))
		}
	}

	tokens = append(tokens, diceToken{kind: tokEOF})
	return tokens, nil
}

type diceExprNode interface {
	format() string
}

type numNode struct {
	val int
}

func (n numNode) format() string {
	return strconv.Itoa(n.val)
}

type dieRollNode struct {
	count      int
	sides      int
	isFudge    bool
	explode    bool
	rerollMax  int
	rerollOnce bool
	keepMode   string
	keepCount  int
	successOp  string
	successVal int
}

func (d dieRollNode) format() string {
	var b strings.Builder
	if d.isFudge {
		fmt.Fprintf(&b, "%ddF", d.count)
	} else {
		fmt.Fprintf(&b, "%dd%d", d.count, d.sides)
	}
	if d.explode {
		b.WriteByte('!')
	}
	if d.rerollMax > 0 {
		if d.rerollOnce {
			fmt.Fprintf(&b, "ro%d", d.rerollMax)
		} else {
			fmt.Fprintf(&b, "r%d", d.rerollMax)
		}
	}
	if d.keepMode != "" {
		fmt.Fprintf(&b, "%s%d", d.keepMode, d.keepCount)
	}
	if d.successOp != "" {
		fmt.Fprintf(&b, "cs%s%d", d.successOp, d.successVal)
	}
	return b.String()
}

type unaryNode struct {
	op   rune
	expr diceExprNode
}

func (u unaryNode) format() string {
	return string(u.op) + u.expr.format()
}

type binOpNode struct {
	op    rune
	left  diceExprNode
	right diceExprNode
}

func (b binOpNode) format() string {
	return fmt.Sprintf("%s %c %s", b.left.format(), b.op, b.right.format())
}

type parenNode struct {
	inner diceExprNode
}

func (p parenNode) format() string {
	return "(" + p.inner.format() + ")"
}

type astParser struct {
	tokens []diceToken
	pos    int
	depth  int
}

func (p *astParser) peek() diceToken {
	if p.pos >= len(p.tokens) {
		return diceToken{kind: tokEOF}
	}
	return p.tokens[p.pos]
}

func (p *astParser) next() diceToken {
	tok := p.peek()
	if p.pos < len(p.tokens) {
		p.pos++
	}
	return tok
}

func (p *astParser) parseExpression() (diceExprNode, error) {
	return p.parseAdditive()
}

func (p *astParser) parseAdditive() (diceExprNode, error) {
	left, err := p.parseMultiplicative()
	if err != nil {
		return nil, err
	}
	for {
		tok := p.peek()
		if tok.kind == tokPlus || tok.kind == tokMinus {
			p.next()
			right, err := p.parseMultiplicative()
			if err != nil {
				return nil, err
			}
			op := '+'
			if tok.kind == tokMinus {
				op = '-'
			}
			left = binOpNode{op: op, left: left, right: right}
			continue
		}
		break
	}
	return left, nil
}

func (p *astParser) parseMultiplicative() (diceExprNode, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		tok := p.peek()
		if tok.kind == tokMul || tok.kind == tokDiv {
			p.next()
			right, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			op := '*'
			if tok.kind == tokDiv {
				op = '/'
			}
			left = binOpNode{op: op, left: left, right: right}
			continue
		}
		break
	}
	return left, nil
}

func (p *astParser) parseUnary() (diceExprNode, error) {
	tok := p.peek()
	if tok.kind == tokPlus || tok.kind == tokMinus {
		p.next()
		inner, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		if tok.kind == tokPlus {
			return inner, nil
		}
		return unaryNode{op: '-', expr: inner}, nil
	}
	return p.parsePrimary()
}

func (p *astParser) parsePrimary() (diceExprNode, error) {
	tok := p.peek()
	switch tok.kind {
	case tokNumber:
		p.next()
		return numNode{val: tok.numVal}, nil
	case tokDice:
		p.next()
		return dieRollNode{
			count:      tok.count,
			sides:      tok.sides,
			isFudge:    tok.isFudge,
			explode:    tok.explode,
			rerollMax:  tok.rerollMax,
			rerollOnce: tok.rerollOnce,
			keepMode:   tok.keepMode,
			keepCount:  tok.keepCount,
			successOp:  tok.successOp,
			successVal: tok.successVal,
		}, nil
	case tokLParen:
		p.next()
		p.depth++
		if p.depth > MaxParenDepth {
			return nil, fmt.Errorf("profundidad de paréntesis excesiva (máximo %d)", MaxParenDepth)
		}
		inner, err := p.parseExpression()
		p.depth--
		if err != nil {
			return nil, err
		}
		if p.peek().kind != tokRParen {
			return nil, fmt.Errorf("paréntesis sin cerrar en la expresión")
		}
		p.next()
		return parenNode{inner: inner}, nil
	default:
		return nil, fmt.Errorf("token inesperado en la expresión de dados")
	}
}

type evalContext struct {
	terms      []DiceTerm
	totalRolls []int
	diceCount  int
	firstSides int
	hasCrit    bool
	hasFumble  bool
}

func rollOneDie(n dieRollNode) (int, error) {
	if n.isFudge {
		v, err := CryptoRandInt(1, 3)
		if err != nil {
			return 0, err
		}
		return v - 2, nil
	}
	v, err := CryptoRandInt(1, n.sides)
	if err != nil {
		return 0, err
	}
	if n.rerollMax > 0 && v <= n.rerollMax {
		if n.rerollOnce {
			v, err = CryptoRandInt(1, n.sides)
			if err != nil {
				return 0, err
			}
		} else {
			for attempt := 0; attempt < MaxRerollAttempts && v <= n.rerollMax; attempt++ {
				v, err = CryptoRandInt(1, n.sides)
				if err != nil {
					return 0, err
				}
			}
		}
	}
	return v, nil
}

func evalAST(node diceExprNode, sign int, ec *evalContext) (int, error) {
	switch n := node.(type) {
	case numNode:
		ec.terms = append(ec.terms, DiceTerm{
			Kind:  "constant",
			Value: n.val * sign,
			Sign:  sign,
		})
		return n.val, nil

	case dieRollNode:
		rolls := make([]int, 0, n.count)
		explosions := 0
		for i := 0; i < n.count; i++ {
			v, err := rollOneDie(n)
			if err != nil {
				return 0, err
			}
			rolls = append(rolls, v)
			// Exploding dice (!) roll again on max face value
			for n.explode && !n.isFudge && v == n.sides && explosions < MaxExplosions {
				explosions++
				ev, err := rollOneDie(n)
				if err != nil {
					return 0, err
				}
				rolls = append(rolls, ev)
				v = ev
			}
		}

		kept := make([]int, len(rolls))
		copy(kept, rolls)
		if n.keepMode != "" && len(rolls) > 1 {
			sorted := make([]int, len(rolls))
			copy(sorted, rolls)
			switch n.keepMode {
			case "kh":
				sort.Slice(sorted, func(i, j int) bool { return sorted[i] > sorted[j] })
				if n.keepCount < len(sorted) {
					kept = sorted[:n.keepCount]
				}
			case "kl":
				sort.Ints(sorted)
				if n.keepCount < len(sorted) {
					kept = sorted[:n.keepCount]
				}
			case "dl":
				sort.Slice(sorted, func(i, j int) bool { return sorted[i] > sorted[j] })
				keepN := len(sorted) - n.keepCount
				if keepN < 1 {
					keepN = 1
				}
				kept = sorted[:keepN]
			case "dh":
				sort.Ints(sorted)
				keepN := len(sorted) - n.keepCount
				if keepN < 1 {
					keepN = 1
				}
				kept = sorted[:keepN]
			}
		}

		sub := 0
		if n.successOp != "" {
			for _, v := range kept {
				if (n.successOp == ">=" && v >= n.successVal) || (n.successOp == ">" && v > n.successVal) {
					sub++
				}
			}
		} else {
			for _, v := range kept {
				sub += v
				if !n.isFudge && n.sides == 20 {
					if v == 20 {
						ec.hasCrit = true
					} else if v == 1 {
						ec.hasFumble = true
					}
				}
			}
		}

		if ec.firstSides == 0 {
			ec.firstSides = n.sides
		}
		ec.diceCount += len(rolls)
		ec.totalRolls = append(ec.totalRolls, rolls...)
		ec.terms = append(ec.terms, DiceTerm{
			Kind:     "dice",
			Notation: n.format(),
			Count:    len(rolls),
			Sides:    n.sides,
			Rolls:    rolls,
			Kept:     kept,
			Subtotal: sub,
			Value:    sub * sign,
			Sign:     sign,
		})
		return sub, nil

	case unaryNode:
		val, err := evalAST(n.expr, -sign, ec)
		if err != nil {
			return 0, err
		}
		return -val, nil

	case parenNode:
		return evalAST(n.inner, sign, ec)

	case binOpNode:
		leftVal, err := evalAST(n.left, sign, ec)
		if err != nil {
			return 0, err
		}
		rightSign := sign
		if n.op == '-' {
			rightSign = -sign
		} else if n.op == '*' || n.op == '/' {
			rightSign = 1
		}
		rightVal, err := evalAST(n.right, rightSign, ec)
		if err != nil {
			return 0, err
		}
		switch n.op {
		case '+':
			return leftVal + rightVal, nil
		case '-':
			return leftVal - rightVal, nil
		case '*':
			return leftVal * rightVal, nil
		case '/':
			if rightVal == 0 {
				return 0, fmt.Errorf("división por cero no permitida")
			}
			return leftVal / rightVal, nil
		}
	}
	return 0, fmt.Errorf("nodo AST desconocido")
}

// RollDice safely parses and evaluates simple, compound arithmetic, and MapTool dicelib expressions
// ("2d6 + 1d4 + 3", "(1d20+4)/2", "2d20kh1", "4d6dl1", "4d6!", "1d20ro1", "5d10cs>=7", "4dF") using crypto/rand.
func RollDice(notation string) (DiceResult, error) {
	tokens, err := tokenizeDiceExpr(notation)
	if err != nil {
		return DiceResult{}, err
	}
	parser := &astParser{tokens: tokens}
	ast, err := parser.parseExpression()
	if err != nil {
		return DiceResult{}, err
	}
	if parser.peek().kind != tokEOF {
		return DiceResult{}, fmt.Errorf("tokens inesperados al final de %q", strings.TrimSpace(notation))
	}

	ec := &evalContext{}
	total, err := evalAST(ast, 1, ec)
	if err != nil {
		return DiceResult{}, err
	}

	diceSub := 0
	for _, term := range ec.terms {
		if term.Kind == "dice" {
			diceSub += term.Value
		}
	}
	modifier := total - diceSub
	if ec.diceCount == 0 {
		diceSub = total
		modifier = 0
	}

	normalized := strings.ReplaceAll(ast.format(), " ", "")
	if normalized == "" {
		normalized = strings.TrimSpace(notation)
	}

	return DiceResult{
		Notation:             normalized,
		NormalizedExpression: ast.format(),
		Count:                ec.diceCount,
		Sides:                ec.firstSides,
		Modifier:             modifier,
		Rolls:                ec.totalRolls,
		Subtotal:             diceSub,
		Total:                total,
		Terms:                ec.terms,
		IsCritical:           ec.hasCrit,
		IsFumble:             ec.hasFumble && !ec.hasCrit,
	}, nil
}
