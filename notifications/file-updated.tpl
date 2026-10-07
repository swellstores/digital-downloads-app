{%-
  # Sent by the app with $notify on a grant (a buyer's access to one order item).
  # Besides the grant's fields and its expanded order, the app passes:
  #   product_name, message (optional), downloads_url
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
            <td style="padding:32px;">
              <p style="font-size:18px;font-weight:600;margin-bottom:24px;">{{ store.name | escape }}</p>
              <p style="font-size:22px;font-weight:600;margin-bottom:8px;">A new version of {{ product_name | escape }} is available</p>
              {%- if message -%}
                <p style="white-space:pre-line;">{{ message | escape }}</p>
              {%- endif -%}
              <p>Your downloads page already has the latest files.</p>
              <p style="margin:24px 0;">
                <a href="{{ downloads_url }}" style="display:inline-block;background:{{ store.color | default: '#1d1d1b' }};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;">Get the update</a>
              </p>
              <p style="color:#6b6b66;font-size:14px;margin:0;">You're getting this because you bought {{ product_name | escape }} in order {{ order.number }}.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>

</html>
