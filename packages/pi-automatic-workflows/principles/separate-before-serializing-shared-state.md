# Separate Before Serializing Shared State

First give concurrent actors independent mutable targets. When one shared target is truly invariant, enforce a single writer or structural serialization rather than relying on convention.

**Relevant when:** Concurrent agents, tasks, or state mutations.

Source: pstack, MIT-licensed, upstream revision `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`. Pi adaptation; see package README for provenance and scope.
