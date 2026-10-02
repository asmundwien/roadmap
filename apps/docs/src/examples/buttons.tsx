import { Button, ButtonLink } from '@roadmap/ui/button'
import { PageDescription, PageHeader, PageTitle } from '@roadmap/ui/page'
import { Surface, SurfaceDescription, SurfaceTitle } from '@roadmap/ui/surface'
import classNames from 'classnames/bind'
import styles from './buttons.module.css'

const cx = classNames.bind(styles)

export function ButtonsPage() {
  return (
    <>
      <PageHeader>
        <PageTitle>Buttons</PageTitle>
        <PageDescription>
          Variants express action role. Appearance sets fill; size sets control height.
        </PageDescription>
      </PageHeader>

      <Surface className={cx('button-example')}>
        <SurfaceTitle>Variant and appearance</SurfaceTitle>
        <SurfaceDescription>
          Use the neutral outline for routine actions. Hover changes the container. Use a solid
          neutral button for the preferred action in a group. Use danger only for destructive
          actions. Keep the initial action outlined. A confirmed destructive action can use the
          solid appearance.
        </SurfaceDescription>
        <div className={cx('button-matrix-scroll')}>
          <div className={cx('button-matrix')}>
            <span />
            <strong className={cx('button-column-label')}>Secondary</strong>
            <strong className={cx('button-column-label')}>Primary</strong>
            <strong className={cx('button-column-label')}>Danger</strong>
            <strong className={cx('button-row-label')}>Outline</strong>
            <div className={cx('button-matrix-example')}>
              <Button variant="secondary" appearance="outline" type="button">
                Routine action
              </Button>
            </div>
            <div className={cx('button-matrix-example')}>
              <Button variant="primary" appearance="outline" type="button">
                Continue
              </Button>
            </div>
            <div className={cx('button-matrix-example')}>
              <Button variant="danger" appearance="outline" type="button">
                Remove
              </Button>
            </div>
            <strong className={cx('button-row-label')}>Solid</strong>
            <div className={cx('button-matrix-example')}>
              <Button variant="secondary" appearance="solid" type="button">
                Routine action
              </Button>
            </div>
            <div className={cx('button-matrix-example')}>
              <Button variant="primary" appearance="solid" type="button">
                Continue
              </Button>
            </div>
            <div className={cx('button-matrix-example')}>
              <Button variant="danger" appearance="solid" type="button">
                Confirm removal
              </Button>
            </div>
          </div>
        </div>
      </Surface>

      <Surface className={cx('button-example')}>
        <SurfaceTitle>Disabled</SurfaceTitle>
        <SurfaceDescription>
          The native disabled attribute blocks activation. The outline and label use the muted pair
          so the label keeps its contrast.
        </SurfaceDescription>
        <Button type="button" disabled>
          Unavailable
        </Button>
      </Surface>

      <Surface className={cx('button-example')}>
        <SurfaceTitle>Navigation</SurfaceTitle>
        <SurfaceDescription>
          Use a button-shaped link for navigation presented as an action. It remains a native link.
        </SurfaceDescription>
        <ButtonLink href="/components/links">Links</ButtonLink>
      </Surface>

      <Surface className={cx('button-example')}>
        <SurfaceTitle>Sizes</SurfaceTitle>
        <SurfaceDescription>
          Small, medium, and large have minimum heights of 32, 40, and 48 pixels. Medium is the
          default and aligns with standard form fields.
        </SurfaceDescription>
        <div className={cx('button-sizes')}>
          <Button size="small" type="button">
            Small
          </Button>
          <Button type="button">Medium</Button>
          <Button size="large" type="button">
            Large
          </Button>
        </div>
      </Surface>
    </>
  )
}
