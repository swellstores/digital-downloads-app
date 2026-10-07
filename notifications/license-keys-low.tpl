{%-
  # Sent by the app with $notify. Besides the product's own fields, the app passes:
  #   available: unused imported keys left
  #   missing: keys an order is still owed because the pool ran out
  #   order_number: that order, when missing > 0
-%}
<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml">

<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style type="text/css">
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
    p { display: block; margin: 0 0 13px 0; }
  </style>
</head>

<body style="word-spacing:normal;">
  <div>
    {%- if missing > 0 -%}
      <p>Order {{ order_number }} was paid, but {{ missing }} license {% if missing == 1 %}key{% else %}keys{% endif %} couldn't be assigned because <a href="{{ store.admin_url }}/products/{{ id }}">{{ name | escape }}</a> ran out of imported keys.</p>
      <p>Import more keys on the product (Actions &rarr; Import license keys), then open the order and choose Actions &rarr; Resend downloads email to give the buyer their keys.</p>
    {%- else -%}
      <p><a href="{{ store.admin_url }}/products/{{ id }}">{{ name | escape }}</a> has {{ available }} imported license {% if available == 1 %}key{% else %}keys{% endif %} left.</p>
      <p>When it runs out, orders for it are stopped at checkout. Import more keys from the product's Actions menu.</p>
    {%- endif -%}
  </div>
</body>

</html>
