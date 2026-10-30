# Minimize Reader Load

Reduce both indirection and hidden mutable state. Keep layers only when they hide meaningful complexity; make ownership and data flow easy to trace.

**Relevant when:** Reviewing or shaping hard-to-follow code.

Source: pstack, MIT-licensed, upstream revision `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`. Pi adaptation; see package README for provenance and scope.
