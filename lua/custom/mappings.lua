local M = {}

M.general = {
  n = {
    [";"] = { ":", "command mode", opts = { nowait = true } },
    ["<leader>q"] = { ":q!<cr>" },
    ["<leader>w"] = { ":w<cr>" },
    ["<leader>mp"] = { ":Telescope keymaps<CR>" },
    ["U"] = { "<C-R>" },
    ["Y"] = { "yy" },
  },
  i = {
    ["jk"] = { "<ESC>" },
  },
}

M.telescope = {
  n = {
    -- find
    ["<C-p>"] = { "<cmd> Telescope find_files <CR>", "find files" },
    ["<leader>p"] = { "<cmd> Telescope live_grep <CR>", "live grep" },
    ["<leader>fu"] = { "<cmd> Telescope lsp_references<CR>", "find references" },
  },
}

M.lspconfig = {
  n = {
    ["<leader>e"] = {
      function()
        vim.lsp.buf.code_action()
      end,
      "lsp code_action",
    },
    ["<leader>["] = {
      function()
        vim.diagnostic.goto_prev()
      end,
      "goto prev",
    },
    ["<leader>]"] = {
      function()
        vim.diagnostic.goto_next()
      end,
      "goto_next",
    },
  },
}

M.typescript = {
  n = {
    ["<leader>o"] = { ":TypescriptOrganizeImports<cr>" },
    ["<leader>rf"] = { ":TypescriptOrganizeImports<cr>" },
  },
}
-- more keybinds!

return M
