# Finite Cycles DSL 0.1

## 1. Basic syntax

A sequence is optional `bpm <integer>`, followed by one or more track
lines. A track line begins with its instrument/track name and contains one
or more cycles or groups.

```text
bpm 120

kick 4:12[1,3,5,7]@>1
snare (3:3[1] 2:2[all])*2
```

The language is organised conceptually as **Object → Operator → Argument**:
track/instrument and cycle are objects; offset, repeat, ratchet and phase
are operators; numbers, sets and sequences are their arguments.

## 2. Instrument

DSL 0.1 instruments are `kick`, `snare`, `hat`, and `clap`. A track can use
an instance suffix of `2` or greater, such as `clap2`. `clap1` is invalid;
an unsuffixed name is the first instance.

## 3. Cycle

A cycle starts with `SPAN:DIVISION`.

```text
4:4
4:7
5/2:2
```

`SPAN` is a positive Rational and `DIVISION` is a positive integer.

## 4. Span

Span is represented exactly as a Rational. Decimal and fraction forms are
accepted where the existing Rational grammar permits them. Runtime never
uses a float as the source of truth for span arithmetic.

## 5. Span modifier

An optional signed offset follows division.

```text
4:7+1
4:7-1
4:7+1/2
```

`+` and `-` are modifier operators. In DSL 0.1 they apply to a cycle's
length only; this does not reserve their future use on other objects.

## 6. Hit set

Hits are written in brackets.

```text
[1,2,3]
[1.25,1.5,2.75]
```

Hits form a **set**. Their authored ordering has no musical meaning, and
the parser canonicalizes them into ascending numeric order. For example,
`[7,5,3,1]` serializes as `[1,3,5,7]`.

## 7. `all`

`[all]` means every active grid position in the cycle, including valid
positions introduced by a positive offset.

```text
4:5[all]
```

`all` is a compact hit-set spelling. Its runtime expands to hits, but its
`hitMode` is retained so the serializer does not rewrite it as a list.

## 8. Ratchet

Ratchet uses `*` inside a hit set.

```text
[all*2]
[1*4,2,3]
```

It subdivides the source hit's division cell. `*1` is equivalent to an
ordinary hit and may serialize without the redundant ratchet suffix.

## 9. Repeat

`*N` after a cycle or group is its repeat operator.

```text
4:12[1,3]*3
(4:4[1] 3:3[1])*2
```

Cycle `*1` may be omitted. The model records whether repeat was explicit,
so an authored `*1` is preserved and an omitted repeat is not inserted by
the serializer. Scalar accumulating phase may have a larger runtime repeat
without rewriting source text.

## 10. Phase

`@` is the time-axis phase operator.

```text
@2
@-2
@>1
@<1
@>1/2
@<1/3
```

`>` moves forward and `<` moves backward in division units. Phase values
are exact Rationals internally. A hold is written as `:H`, for example
`@>1:3`.

## 11. Sequence

Phase sequences use parentheses.

```text
@>(1,-2,-1)
@>(1,-2,1/2):3
```

A sequence is **ordered** data. Its order is never sorted, deduplicated,
or otherwise canonicalized: `(1,-2,-1)` stays in that order.

## 12. Random

`?` is the random operator currently used in phase forms.

```text
@?
@?(1,-2,-1)
@?>(1,-2,-1)
@?<(1,-2,-1)
```

Random decisions use the existing deterministic repeat resolver so audio
and visual output agree. DSL 0.1 does not make `?` phase-exclusive as a
language-design rule, but does not add any new application site for it.

## 13. Operators

DSL 0.1 operator symbols are `?`, `@`, `>`, `<`, `*`, `+`, and `-`.
Their meaning depends on their object context: for example `*` means cycle
repeat after a cycle and ratchet subdivision inside a hit set. No new
operator meanings are introduced by this specification.

## 14. Operator chain

Phase forms are represented internally as structured phase objects with
type, direction, Rational values, hold, and source token. This is the AST
equivalent for the existing operator chain. Operators are evaluated left to
right when a future formal chain is introduced; undefined spellings such as
`?@>1` and `@?>1` remain invalid in DSL 0.1.

## 15. Canonicalization

The parser canonicalizes only meaning-preserving **sets**:

```text
[3.5,1,2.5] -> [1,2.5,3.5]
```

It does not reorder sequences, replace an authored phase spelling, expand
`all`, or inject an omitted repeat. GUI hit edits use the same ascending
hit-set serializer.

## 16. Parser, runtime, serializer

The parser converts text to structured tracks, cycles, hit mode/ratchets,
phase objects, and repeat explicitness. Runtime resolves those structures
for scheduling and visuals. The serializer converts them back to DSL,
applying only the canonicalization rules above. Relationship and other
derived calculations are not stored in cycle data.

## 17. Reserved words and symbols

Reserved instrument words are `kick`, `snare`, `hat`, and `clap`. No words
such as `reverse`, `mirror`, or `invert` are reserved in DSL 0.1. The
currently meaningful symbols are listed in [Operators](#13-operators).

## 18. Future reserved syntax

Future work may add generic operator chains and time-axis transforms. In
particular, Reverse will mean reflection of hit positions across a cycle's
time axis, not reversal of the textual hit list. Reverse, Mirror, Invert,
new random application sites, new phase forms, and relationship DSL syntax
are all outside DSL 0.1.
