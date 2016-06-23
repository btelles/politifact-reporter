import webapp2


class IndexHandler(webapp2.RequestHandler):

  def get(self):
    self.redirect('/dashboard/index.html', True)

application = webapp2.WSGIApplication([(r'/dashboard$', IndexHandler)])
