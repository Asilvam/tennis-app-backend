import { buildEmailShell, escapeHtml } from './email-layout.template';

describe('email layout templates', () => {
  it('escapes unsafe HTML characters and nullish values', () => {
    expect(escapeHtml(`<tag attr="value">Tom & 'Jerry'</tag>`)).toBe(
      '&lt;tag attr=&quot;value&quot;&gt;Tom &amp; &#039;Jerry&#039;&lt;/tag&gt;',
    );
    expect(escapeHtml(null)).toBe('');
  });

  it('builds a shell with escaped labels and trusted content', () => {
    const html = buildEmailShell({
      title: '<Title>',
      eyebrow: 'A & B',
      accent: '#fff',
      content: '<p>Trusted body</p>',
    });

    expect(html).toContain('&lt;Title&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('background:#fff');
    expect(html).toContain('<p>Trusted body</p>');
  });
});
