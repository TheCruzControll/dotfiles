return {
  ["jose-elias-alvarez/null-ls.nvim"] = {
    after = "nvim-lspconfig",
    config = function()
      require "custom.plugins.null-ls"
    end,
  },
  ["christoomey/vim-tmux-navigator"] = {},
  ["ThePrimeagen/refactoring.nvim"] = {},
  ["tpope/vim-surround"] = {},
  ["jose-elias-alvarez/typescript.nvim"] = {},
  -- ["glepnir/lspsaga.nvim"] = {
  --   branch = "main",
  --   config = function()
  --     require "custom.plugins.lspsaga"
  --   end,
  -- },
}
