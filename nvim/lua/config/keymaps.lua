-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here
local map = vim.keymap.set

-- undo
map({ "n" }, "U", "<C-R>")

-- save file
map({ "n" }, "<leader>w", "<cmd>w!<cr><esc>")
map({ "n" }, "<leader>q", "<cmd>q!<cr><esc>")
map({ "i" }, "jk", "<esc>")

-- diagnostic
local diagnostic_goto = function(next, severity)
  local go = next and vim.diagnostic.goto_next or vim.diagnostic.goto_prev
  severity = severity and vim.diagnostic.severity[severity] or nil
  return function()
    go({ severity = severity })
  end
end
map("n", "<leader>]", diagnostic_goto(true), { desc = "Next Diagnostic" })
map("n", "<leader>[", diagnostic_goto(false), { desc = "Prev Diagnostic" })

-- tmux navigator
map("n", "<C-h>", "<Cmd>TmuxNavigateLeft<CR>")
map("n", "<C-j>", "<Cmd>TmuxNavigateDown<CR>")
map("n", "<C-k>", "<Cmd>TmuxNavigateUp<CR>")
map("n", "<C-l>", "<Cmd>TmuxNavigateRight<CR>")

-- lsp
map("n", "<leader>o", "<Cmd>lua vim.lsp.buf.code_action()<CR>")
