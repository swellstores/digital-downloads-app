{%-
  # Sent by the app with $notify. Besides the order's own fields, the app passes:
  #   downloads_url: the buyer's private downloads page
  #   downloads: [{ product_name, variant_name, deliverables: [{ name, version }], license_keys: [string] }]
-%}
<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml">

<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style type="text/css">
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; background: #f6f6f4; }
    p { margin: 0 0 14px 0; }
  </style>
</head>

<body style="word-spacing:normal;background:#f6f6f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f4;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1b;font-size:16px;line-height:1.5;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              {%- if store.logo.url -%}
                <img src="{{ store.logo.url }}" alt="{{ store.name | escape }}" width="{{ store.logo_width | default: 120 }}" style="display:block;border:0;max-width:200px;height:auto;margin-bottom:24px;">
              {%- else -%}
                <p style="font-size:18px;font-weight:600;margin-bottom:24px;">{{ store.name | escape }}</p>
              {%- endif -%}
              <p style="font-size:22px;font-weight:600;margin-bottom:8px;">Your downloads are ready</p>
              <p style="color:#6b6b66;">Order {{ number }}</p>
              <p>{{ content.intro | escape }}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px 32px;">
              <a href="{{ downloads_url }}" style="display:inline-block;background:{{ store.color | default: '#1d1d1b' }};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;">Get your downloads</a>
            </td>
          </tr>
          {%- for item in downloads -%}
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e4e4df;">
                <p style="font-weight:600;margin-bottom:4px;">{{ item.product_name | escape }}{% if item.variant_name %} <span style="color:#6b6b66;font-weight:400;">{{ item.variant_name | escape }}</span>{% endif %}</p>
                {%- for deliverable in item.deliverables -%}
                  <p style="color:#6b6b66;font-size:14px;margin:0 0 4px 0;">{{ deliverable.name | escape }}{% if deliverable.version %} &middot; v{{ deliverable.version | escape }}{% endif %}</p>
                {%- endfor -%}
                {%- if item.license_keys.size > 0 -%}
                  <p style="font-size:14px;color:#6b6b66;margin:12px 0 6px 0;">{% if item.license_keys.size == 1 %}License key{% else %}License keys{% endif %}</p>
                  {%- for key in item.license_keys -%}
                    <p style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;background:#f6f6f4;border:1px solid #e4e4df;border-radius:8px;padding:8px 12px;margin:0 0 6px 0;">{{ key | escape }}</p>
                  {%- endfor -%}
                {%- endif -%}
              </td>
            </tr>
          {%- endfor -%}
          <tr>
            <td style="padding:16px 32px 32px 32px;border-top:1px solid #e4e4df;color:#6b6b66;font-size:14px;">
              <p>Keep this email. The button above is how you get back to your downloads, so don't share it.</p>
              {%- if store.support_email -%}
                <p style="margin:0;">Questions? Email <a href="mailto:{{ store.support_email }}" style="color:#6b6b66;">{{ store.support_email }}</a>.</p>
              {%- endif -%}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>

</html>
