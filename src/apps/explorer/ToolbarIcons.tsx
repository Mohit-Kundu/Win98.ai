const P = { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true } as const;

export const NewFolderIcon = () => (
  <svg {...P}>
    <path d="M2 5h8l2 2h10v13H2z" fill="#ffd84a" stroke="#000" strokeLinejoin="round" />
    <path d="M18 1v6M15 4h6" stroke="#008000" strokeWidth="2" />
  </svg>
);

export const UploadIcon = () => (
  <svg {...P}>
    <path d="M3 15v6h18v-6" fill="none" stroke="#000" strokeWidth="1.5" />
    <path d="M12 3l-6 7h4v7h4v-7h4z" fill="#0000c0" stroke="#000" strokeLinejoin="round" />
  </svg>
);

export const OrganizeIcon = () => (
  <svg {...P}>
    <path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#c000c0" stroke="#000" strokeLinejoin="round" />
  </svg>
);
